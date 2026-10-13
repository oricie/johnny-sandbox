import fs from "node:fs";
import path from "node:path";
import { OUT, ROOT } from "./paths";
import { buildCodeGraph } from "./observe/codeGraph";
import { loadKnowledge } from "./observe/knowledge";
import { loadSignals } from "./observe/signals";
import { buildEvidencePacks } from "./decide/evidence";
import { decide, type Decision } from "./decide/decide";
import { checkPlan } from "./guard/constraints";
import { checkCitations } from "./guard/citations";
import { buildSlackMessage } from "./report/slack";
import { implementOption } from "./act/implement";
import { screenshot } from "./verify/screenshots";
import { buildThreadPage, type OptionResult } from "./report/thread";

// Flags:
//   --observe-only        stop after observe
//   --decision <file>     reuse a saved decision instead of calling the model to decide
//   --act                 implement both options in worktrees, check, screenshot, write out/thread.html
const args = process.argv.slice(2);
const flag = (name: string) => args.includes(name);
const value = (name: string) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };

const t0 = Date.now();
const lap = (label: string) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s] ${label}`);

const graph = buildCodeGraph();
const knowledge = loadKnowledge();
const signals = loadSignals();
const packs = buildEvidencePacks(graph, knowledge, signals);
fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, "evidence.json"), JSON.stringify({ graph, packs }, null, 2));
lap(`observe: ${Object.keys(graph.nodes).length} files, ${packs.length} screens, ${signals.length} signals -> out/evidence.json`);
if (flag("--observe-only")) process.exit(0);

const saved = value("--decision");
const decision: Decision = saved
  ? JSON.parse(fs.readFileSync(path.resolve(ROOT, saved), "utf8"))
  : await decide(packs);
fs.writeFileSync(path.join(OUT, "decision.json"), JSON.stringify(decision, null, 2));
lap(`decide${saved ? ` (from ${saved})` : ""}: ${decision.findings.length} findings, chose "${decision.chosen_finding}"`);

for (const o of decision.options) {
  const plan = checkPlan(o.files_to_change);
  console.log(`  option ${o.id} plan: ${plan.ok ? "ok" : `REJECTED, touches ${plan.violations.join(", ")}`}`);
}
const citations = checkCitations(decision, knowledge);
const valid = citations.total - citations.invalid.length;
lap(`citations: ${valid}/${citations.total} valid`);

fs.writeFileSync(path.join(OUT, "slack-message.json"), JSON.stringify({ blocks: buildSlackMessage(decision, { citations }) }, null, 2));
lap("report: out/slack-message.json");
if (!flag("--act")) process.exit(0);

// Act: both options in parallel, each in its own worktree.
const allowed = decision.options.filter((o) => checkPlan(o.files_to_change).ok);
const results: OptionResult[] = await Promise.all(allowed.map(async (o) => {
  try {
    const r = await implementOption(decision, o);
    lap(`act ${o.id}: ${r.ok ? `committed ${r.sha} on ${r.branch}` : "checks failed, not committed"}`);
    return r;
  } catch (e) {
    lap(`act ${o.id}: failed (${(e as Error).message})`);
    return { option: o.id, branch: `johnny/option-${o.id.toLowerCase()}`, ok: false, summary: "", checks: (e as Error).message };
  }
}));

// Verify: same route, same seed data, before vs each option.
const screen = decision.findings.find((f) => f.title === decision.chosen_finding)?.screen ?? "/";
const shots = path.join(OUT, "shots");
fs.mkdirSync(shots, { recursive: true });
const before = path.join(shots, "before.png");
await screenshot(ROOT, screen, before, 4301);
let port = 4302;
for (const r of results) {
  if (!r.ok) continue;
  r.shot = path.join(shots, `option-${r.option.toLowerCase()}.png`);
  await screenshot(path.join(ROOT, ".worktrees", `option-${r.option.toLowerCase()}`), screen, r.shot, port++);
}
lap(`verify: screenshots in out/shots`);

fs.writeFileSync(path.join(OUT, "results.json"), JSON.stringify(results, null, 2));
fs.writeFileSync(path.join(OUT, "thread.html"), buildThreadPage(decision, results, before, { total: citations.total, valid }));
lap("report: out/thread.html");
