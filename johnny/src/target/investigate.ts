import fs from "node:fs";
import path from "node:path";
import { costUSD, usage } from "../llm";
import { OUT } from "../paths";
import { buildRouteGraph } from "./graph";
import { buildMonorepoGraph } from "./monorepo";
import { investigate } from "./investigateCore";

// Johnny on an external repo, investigating. Usage:
//   tsx src/target/investigate.ts <repo-root> [--app <app dir>] [--steps <n>] [--runs <n>]
// With --runs, the investigations run in parallel and the report compares what each one found.
const root = path.resolve(process.argv[2]);
const arg = (name: string) => { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] : undefined; };
const runs = Number(arg("--runs") ?? 1);
const t0 = Date.now();
const lap = (s: string) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s] ${s}`);

const routes = arg("--app") ? buildMonorepoGraph(root, arg("--app")!) : buildRouteGraph(root);
lap(`observe: ${routes.length} routes`);
const readme = fs.existsSync(path.join(root, "README.md")) ? fs.readFileSync(path.join(root, "README.md"), "utf8").slice(0, 6000) : "";

const rules = `
There is no usage data and no written product decisions for this product. So:
- Evidence is code only. The README may be cited as "README.md".
- Impact is your judgement; say so in the reason and do not invent metrics, user quotes or research.`;

const settled = await Promise.allSettled(Array.from({ length: runs }, (_, i) => investigate({
  root, routes, rules, intro: `README:\n${readme}`, maxSteps: Number(arg("--steps") ?? 40),
  validNonFile: (s) => (s === "README.md" ? !!readme : undefined),
  onStep: runs === 1 ? (l) => console.log(`  ${l}`) : undefined,
}).then((inv) => { lap(`run ${i + 1}: ${inv.steps} steps, ${Object.keys(inv.filesRead).length} files, chose "${inv.decision.chosen_finding}"`); return inv; })));

const rows = settled.map((s, i) => {
  if (s.status === "rejected") return { run: i + 1, error: (s.reason as Error).message };
  const { decision: d, citations, steps, filesRead, charsRead } = s.value;
  const chosen = d.findings.find((f) => f.title === d.chosen_finding);
  return { run: i + 1, screen: chosen?.screen, chosen: d.chosen_finding, steps, files: Object.keys(filesRead).length,
    kchars: Math.round(charsRead / 1000), citations: `${citations.filter((c) => c.ok).length}/${citations.length}`, findings: d.findings.length };
});

fs.mkdirSync(OUT, { recursive: true });
const file = path.join(OUT, `investigate-${path.basename(root)}${runs > 1 ? `-x${runs}` : ""}.json`);
fs.writeFileSync(file, JSON.stringify({ repo: root, runs, seconds: (Date.now() - t0) / 1000, usage: { ...usage, usd: costUSD() }, rows,
  investigations: settled.map((s) => (s.status === "fulfilled" ? s.value : null)) }, null, 2));
if (runs > 1) console.table(rows.map((r) => ({ ...r, chosen: "chosen" in r ? String(r.chosen).slice(0, 70) : undefined })));
else if ("chosen" in rows[0]) lap(`citations: ${rows[0].citations} valid`);
lap(`report: ${path.relative(path.dirname(OUT), file)}`);
console.log(`cost: ${usage.calls} calls, ${usage.input} in / ${usage.cacheRead} cache-read / ${usage.cacheWrite} cache-write / ${usage.output} out tokens, $${costUSD().toFixed(2)}`);
