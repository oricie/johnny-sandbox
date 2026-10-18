import fs from "node:fs";
import path from "node:path";
import { costUSD, structured, usage } from "../llm";
import { OUT } from "../paths";
import { DECISION_SCHEMA, type Decision } from "../decide/decide";
import { buildRouteGraph, type RouteInfo } from "./graph";
import { buildMonorepoGraph } from "./monorepo";

// Johnny on an external repo, decide only. Usage:
//   tsx src/target/run.ts <repo-root> [--budget <chars>] [--app <app dir, e.g. apps/web/app>]
// Stage 1 sees a map of the product (routes, their own components, sizes) and picks where to look.
// Stage 2 sees the full source of those routes, within a character budget, and decides.
const root = path.resolve(process.argv[2]);
const budgetArg = process.argv.indexOf("--budget");
const BUDGET = budgetArg >= 0 ? Number(process.argv[budgetArg + 1]) : 400_000;
const appArg = process.argv.indexOf("--app");
const read = (f: string) => fs.readFileSync(path.join(root, f), "utf8");
const t0 = Date.now();
const lap = (s: string) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s] ${s}`);

const routes = appArg >= 0 ? buildMonorepoGraph(root, process.argv[appArg + 1]) : buildRouteGraph(root);
const allFiles = new Set(routes.flatMap((r) => r.files));
const totalChars = [...allFiles].reduce((n, f) => n + read(f).length, 0);
lap(`observe: ${routes.length} routes, ${allFiles.size} files reachable from pages, ${(totalChars / 1000).toFixed(0)}k chars`);

const readme = fs.existsSync(path.join(root, "README.md")) ? read("README.md").slice(0, 6000) : "";

// A route's "own" files live under its page directory; the rest are shared.
const own = (r: RouteInfo) => r.files.filter((f) => f.startsWith(path.dirname(r.page)));
// In a large app most of a page's reachable code is server, data and API plumbing, and BFS order
// reaches it before the view. For a UX review, rendered code comes first: components before
// server code, nearest to the page first within each group.
const SERVER = /(^|\/)(server|trpc|prisma|repositor(y|ies)|migrations|api)\/|\.(repository|service|handler|schema)\.ts$|Repository\.ts$|Service\.ts$/i;
const uiFirst = (files: string[]) => [...files.filter((f) => f.endsWith(".tsx") && !SERVER.test(f)),
  ...files.filter((f) => !f.endsWith(".tsx") && !SERVER.test(f)), ...files.filter((f) => SERVER.test(f))];
const viewFiles = (r: RouteInfo) => uiFirst(r.files).filter((f) => f !== r.page && f.endsWith(".tsx")).slice(0, 8);
const map = routes.map((r) =>
  `${r.route}  page=${r.page}  files=${r.files.length} lines=${r.lines}  views=[${(own(r).length > 1 ? own(r) : viewFiles(r)).map((f) => path.basename(f, ".tsx")).slice(0, 12).join(", ")}]`).join("\n");

const pick = await structured<{ routes: { route: string; why: string }[]; product_summary: string }>(
  `You are Johnny, a product design agent. You are looking at an existing product's codebase for the first time.
From the README and the route map, work out what the product is and who uses it, then choose the 2 routes
where a UX problem would hurt the core users most and that are worth reading in full. Prefer screens core users
use often over admin or rarely used screens. Use routes exactly as written in the map.`,
  `README:\n${readme}\n\nRoute map (${routes.length} routes):\n${map}`,
  {
    type: "object", additionalProperties: false, required: ["product_summary", "routes"],
    properties: {
      product_summary: { type: "string" },
      routes: { type: "array", items: { type: "object", additionalProperties: false, required: ["route", "why"],
        properties: { route: { type: "string" }, why: { type: "string" } } } },
    },
  },
);
lap(`select: ${pick.product_summary.slice(0, 120)}...`);
for (const r of pick.routes) console.log(`  -> ${r.route}: ${r.why}`);

// Stage 2 context: chosen routes' files, own files first, then shared, until the budget runs out.
const chosen = routes.filter((r) => pick.routes.some((p) => p.route === r.route));
const ordered = [...new Set(chosen.flatMap((r) => [r.page, ...own(r), ...uiFirst(r.files.filter((f) => !own(r).includes(f)))]))];
let used = 0;
const included: string[] = [];
for (const f of ordered) {
  const n = read(f).length;
  if (used + n > BUDGET) continue;
  used += n;
  included.push(f);
}
const omitted = ordered.filter((f) => !included.includes(f));
lap(`context: ${included.length} files, ${(used / 1000).toFixed(0)}k chars (${omitted.length} shared files left out)`);
const numbered = (f: string) => read(f).split("\n").map((l, i) => `${i + 1}| ${l}`).join("\n");

const decision = await structured<Decision>(
  `You are Johnny, a product design agent. Nobody told you what to fix. Read the screens below and find the UX
problems that would hurt this product's core users most, rank them, and pick one to fix now.

There is no usage data and no written product decisions for this product. So:
- Evidence is code only. Cite file paths with line numbers exactly as numbered below, e.g. "src/app/x/Page.tsx:42".
  The README may be cited as "README.md".
- Impact is your judgement; say so in the reason and do not invent metrics, user quotes or research.
- Some things that look odd may be deliberate. If code suggests a choice was intentional, say so and mark it do_not_change or later.
- Propose exactly two options, A and B, with different approaches to the root cause, changing only files you were shown.
- Use the product's own components and patterns that appear in the code.`,
  `Product: ${pick.product_summary}\n\nREADME:\n${readme}\n\nRoutes chosen for review: ${pick.routes.map((r) => r.route).join(", ")}\n` +
  `Files not shown (shared, over budget): ${omitted.join(", ") || "none"}\n\nSource:\n` +
  included.map((f) => `--- ${f}\n${numbered(f)}`).join("\n\n"),
  DECISION_SCHEMA,
);
lap(`decide: ${decision.findings.length} findings, chose "${decision.chosen_finding}"`);

// Strict citation check: the file must exist and every cited line must be inside it.
const checks = decision.findings.flatMap((f) => f.evidence.map((e) => {
  if (e.source === "README.md") return { ...e, ok: !!readme };
  const m = /^([^:]+?)(?::(\d+)(?:-(\d+))?)?$/.exec(e.source.trim());
  if (!m || !fs.existsSync(path.join(root, m[1]))) return { ...e, ok: false };
  const n = read(m[1]).split("\n").length;
  const lines = [m[2], m[3]].filter(Boolean).map(Number);
  return { ...e, ok: lines.every((l) => l >= 1 && l <= n) && (included.includes(m[1]) || m[1] === "README.md") };
}));
const bad = checks.filter((c) => !c.ok);
lap(`citations: ${checks.length - bad.length}/${checks.length} valid` + (bad.length ? `; invalid: ${bad.map((b) => b.source).join(", ")}` : ""));

fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, `target-${path.basename(root)}.json`),
  JSON.stringify({ repo: root, seconds: (Date.now() - t0) / 1000, usage: { ...usage, usd: costUSD() }, pick, context: { included, omitted, chars: used }, decision, citations: checks }, null, 2));
lap(`report: out/target-${path.basename(root)}.json`);
console.log(`cost: ${usage.calls} calls, ${usage.input} in / ${usage.output} out tokens, $${costUSD().toFixed(2)}`);
