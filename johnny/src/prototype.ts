import fs from "node:fs";
import path from "node:path";
import { ROOT, OUT, matchGlob } from "./paths";
import { structured, imageBlocks } from "./llm";
import { constraints } from "./guard/constraints";
import { createWorktree, commitAll } from "./act/worktree";
import { runChecks } from "./act/checks";
import { screenshotMany } from "./verify/screenshots";
import { deployPreview } from "./verify/preview";

// Exploration mode: several quick, different directions for an idea, each a working screen in the
// real product (same components, data and tokens) but outside the navigation, on a throwaway branch.
// Not for merging: a chosen direction becomes a normal request with all the usual checks.

export interface Direction { name: string; title: string; idea: string; tradeoff: string }
export interface PrototypeResult {
  brief: string;
  branch: string;
  ok: boolean;
  checks: string;
  directions: (Direction & { route: string; shot?: string; preview?: string })[];
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "proto";

const PLAN_SYSTEM = `You are exploring an idea for the product with quick working prototypes, not shipping a fix.
Propose genuinely different directions (different concepts, layouts or interaction models, not color
variants). Each must make sense for this product's users and data. Name each with a short kebab-case
name. Write title, idea and tradeoff in the language of the brief.`;

const BUILD_SYSTEM = `Build one exploration prototype as a single React + TypeScript file. Rules:
- Default-export a component with no props. It is rendered inside the app shell (nav on the left).
- Reuse the product's components, styles and tokens (import from "../components/...", "../api/...",
  "../data/..."), so it looks like part of the product. Inline styles must use CSS variables from tokens.css.
- Use the product's real data (getAlerts, getIncident, seed data). No new dependencies.
- Make it feel real: realistic content, a few working interactions where they matter to the idea.
- It must pass strict TypeScript. Return only the file content.`;

function productSource() {
  const base = path.join(ROOT, "demo-app/src");
  return (fs.readdirSync(base, { recursive: true }) as string[])
    .filter((f) => /\.(tsx?|css)$/.test(f) && !f.startsWith("prototypes"))
    .map((f) => `--- demo-app/src/${f}\n${fs.readFileSync(path.join(base, f), "utf8")}`).join("\n\n");
}

export async function prototype(brief: string, opts: { variants?: number; images?: string[]; onProgress?: (s: string) => void | Promise<void> } = {}): Promise<PrototypeResult> {
  const n = Math.min(Math.max(opts.variants ?? 3, 2), 5);
  const context = ["context/product.md", "context/personas.md", "context/design-system.md", "context/decisions.md"]
    .map((f) => `--- ${f}\n${fs.readFileSync(path.join(ROOT, f), "utf8")}`).join("\n\n");
  const withImages = (text: string) => (opts.images?.length ? [...imageBlocks(opts.images), { type: "text" as const, text }] : text);

  const plan = await structured<{ directions: Direction[] }>(PLAN_SYSTEM,
    withImages(`Brief: ${brief}\nNumber of directions: ${n}\n\n${context}`),
    {
      type: "object", additionalProperties: false, required: ["directions"],
      properties: { directions: { type: "array", items: {
        type: "object", additionalProperties: false, required: ["name", "title", "idea", "tradeoff"],
        properties: { name: { type: "string" }, title: { type: "string" }, idea: { type: "string" }, tradeoff: { type: "string" } },
      } } },
    }, "medium");
  const directions = plan.directions.slice(0, n).map((d, i) => ({ ...d, name: `${slug(d.name)}-${i + 1}` }));
  await opts.onProgress?.(`Directions: ${directions.map((d) => d.title).join(" · ")}. Building them…`);

  const { branch, dir } = createWorktree(`proto-${slug(brief).slice(0, 20)}`);
  const source = productSource();
  const fileFor = (d: Direction) => `demo-app/src/prototypes/${d.name}.tsx`;
  const write = (f: string, content: string) => {
    if (!constraints.prototype_paths.some((p) => matchGlob(p, f))) throw new Error(`Prototype path not allowed: ${f}`);
    fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true });
    fs.writeFileSync(path.join(dir, f), content);
  };
  const build = (d: Direction, extra = "") => structured<{ content: string }>(BUILD_SYSTEM,
    withImages(`Brief: ${brief}\n\nThis direction: ${d.title}\n${d.idea}\nTradeoff: ${d.tradeoff}\n\n` +
      `File to write: ${fileFor(d)}\n\n${context}\n\nProduct source:\n${source}${extra}`),
    { type: "object", additionalProperties: false, required: ["content"], properties: { content: { type: "string" } } }, "medium");

  const files = await Promise.all(directions.map(async (d) => ({ d, content: (await build(d)).content })));
  for (const f of files) write(fileFor(f.d), f.content);
  let checks = runChecks(dir);
  if (!checks.ok) {
    // One repair round, only for the prototypes the errors point at.
    const broken = files.filter((f) => checks.output.includes(`${f.d.name}.tsx`));
    await Promise.all((broken.length ? broken : files).map(async (f) =>
      write(fileFor(f.d), (await build(f.d, `\n\nYour previous version failed the checks. Fix it:\n${checks.output}\n\nPrevious version:\n${f.content}`)).content)));
    checks = runChecks(dir);
  }
  const result: PrototypeResult = {
    brief, branch, ok: checks.ok, checks: checks.output,
    directions: directions.map((d) => ({ ...d, route: `/proto/${d.name}` })),
  };
  if (!checks.ok) return result;
  commitAll(dir, `Johnny: prototypes for "${brief.slice(0, 60)}"\n\n${directions.map((d) => `- ${d.title}: ${d.idea}`).join("\n")}`);
  await opts.onProgress?.("Built and checked. Taking screenshots and publishing…");

  const shots = path.join(OUT, "shots", "proto");
  fs.mkdirSync(shots, { recursive: true });
  for (const d of result.directions) d.shot = path.join(shots, `${d.name}.png`);
  await screenshotMany(dir, result.directions.map((d) => ({ route: d.route, file: d.shot! })), 4310);
  const url = await deployPreview(path.join(dir, "demo-app", "dist"), `prototypes: ${brief.slice(0, 40)}`).catch(() => undefined);
  if (url) for (const d of result.directions) d.preview = `${url}/#${d.route}`;
  fs.writeFileSync(path.join(OUT, "prototype.json"), JSON.stringify(result, null, 2));
  return result;
}
