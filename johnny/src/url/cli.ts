import fs from "node:fs";
import path from "node:path";
import { costUSD, usage } from "../llm";
import { OUT } from "../paths";
import { reviewUrl } from "./review";
import { reportPage } from "./report";

// Usage: tsx src/url/cli.ts <url> [--goal "buy a t-shirt"] [--steps <n>]
const url = process.argv[2];
const arg = (name: string) => { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] : undefined; };
const outDir = path.join(OUT, "url-review", new URL(url).hostname);
fs.rmSync(outDir, { recursive: true, force: true });
const t0 = Date.now();
const lap = (s: string) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s] ${s}`);

const r = await reviewUrl({ url, goal: arg("--goal"), outDir, maxSteps: Number(arg("--steps") ?? 18), onStep: (l) => console.log(`  ${l}`) });
lap(`review: ${r.looks.length} looks, ${r.review.findings.length} findings, chose "${r.review.chosen}"`);
const report = { url, seconds: (Date.now() - t0) / 1000, usage: { ...usage, usd: costUSD() }, ...r.review,
  looks: r.looks.map(({ id, url, title }) => ({ id, url, title })), annotated: r.annotated, sketches: r.sketches };
fs.writeFileSync(path.join(outDir, "review.json"), JSON.stringify(report, null, 2));
fs.writeFileSync(path.join(outDir, "review.html"), reportPage(report, outDir));
lap(`report: ${path.relative(path.dirname(OUT), path.join(outDir, "review.html"))}`);
console.log(`cost: ${usage.calls} calls, ${usage.input} in / ${usage.cacheRead} cache-read / ${usage.cacheWrite} cache-write / ${usage.output} out tokens, $${costUSD().toFixed(2)}`);
