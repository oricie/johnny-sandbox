import fs from "node:fs";
import path from "node:path";
import { costUSD, usage } from "../llm";
import { OUT } from "../paths";
import { buildMonorepoGraph } from "./monorepo";
import { locate } from "./locate";

// Scores the bridge on real fixes: does Johnny, from a user's words alone, land on the files the fix changed?
// Usage: tsx src/target/locateEval.ts <repo-root> <cases.json>
const root = path.resolve(process.argv[2]);
const spec = JSON.parse(fs.readFileSync(process.argv[3], "utf8")) as { app: string; cases: { commit: string; report: string; truth: string[] }[] };
const routes = buildMonorepoGraph(root, spec.app);
const t0 = Date.now();

const rows: Record<string, unknown>[] = [];
const queue = [...spec.cases];
await Promise.all(Array.from({ length: 4 }, async () => {
  for (let c = queue.shift(); c; c = queue.shift()) {
    try {
      const r = await locate(root, routes, c.report);
      const files = r.components.map((x) => x.file);
      rows.push({ commit: c.commit, top1: c.truth.includes(files[0]), top3: files.slice(0, 3).some((f) => c.truth.includes(f)),
        any: files.some((f) => c.truth.includes(f)), confidence: r.confidence, steps: r.steps, first: files[0], truth: c.truth[0], result: r });
    } catch (e) {
      rows.push({ commit: c.commit, error: (e as Error).message });
    }
    console.log(`  ${c.commit} done (${rows.length}/${spec.cases.length})`);
  }
}));

const n = spec.cases.length;
const count = (k: string) => rows.filter((r) => r[k]).length;
fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, "locate-eval.json"), JSON.stringify({ seconds: (Date.now() - t0) / 1000, usage: { ...usage, usd: costUSD() }, rows }, null, 2));
console.table(rows.map(({ result, ...r }) => r));
console.log(`top-1 ${count("top1")}/${n} · top-3 ${count("top3")}/${n} · any ${count("any")}/${n} · ${((Date.now() - t0) / 1000).toFixed(0)}s · $${costUSD().toFixed(2)}`);
