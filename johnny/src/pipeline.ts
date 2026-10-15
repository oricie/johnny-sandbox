import fs from "node:fs";
import path from "node:path";
import { OUT, ROOT } from "./paths";
import { buildCodeGraph } from "./observe/codeGraph";
import { loadKnowledge } from "./observe/knowledge";
import { loadSignals } from "./observe/signals";
import { buildEvidencePacks } from "./decide/evidence";
import { decide, decideRequest, type Decision } from "./decide/decide";
import { checkPlan } from "./guard/constraints";
import { checkCitations } from "./guard/citations";
import { buildSlackMessage } from "./report/slack";
import { implementOption } from "./act/implement";
import { screenshot } from "./verify/screenshots";
import { buildThreadPage, type OptionResult } from "./report/thread";

export interface RunOptions {
  request?: string; // request mode; otherwise Johnny's own review
  decisionFile?: string; // reuse a saved decision
  act?: boolean; // implement, check and screenshot both options
  onProgress?: (stage: "observed" | "decided" | "acted" | "verified", detail: string) => void | Promise<void>;
}

export interface RunResult {
  decision: Decision;
  citations: { total: number; valid: number };
  results: OptionResult[];
  beforeShot?: string;
}

// Observe -> decide -> guard -> (act -> verify). Writes the same files under out/ as before.
export async function runJohnny(opts: RunOptions = {}): Promise<RunResult> {
  const progress = async (s: Parameters<NonNullable<RunOptions["onProgress"]>>[0], d: string) => opts.onProgress?.(s, d);

  const graph = buildCodeGraph();
  const knowledge = loadKnowledge();
  const signals = loadSignals();
  const packs = buildEvidencePacks(graph, knowledge, signals);
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, "evidence.json"), JSON.stringify({ graph, packs }, null, 2));
  await progress("observed", `${Object.keys(graph.nodes).length} files, ${packs.length} screens, ${signals.length} signals`);

  const decision: Decision = opts.decisionFile
    ? JSON.parse(fs.readFileSync(path.resolve(ROOT, opts.decisionFile), "utf8"))
    : opts.request ? await decideRequest(packs, opts.request) : await decide(packs);
  fs.writeFileSync(path.join(OUT, "decision.json"), JSON.stringify(decision, null, 2));
  const c = checkCitations(decision, knowledge);
  const citations = { total: c.total, valid: c.total - c.invalid.length };
  fs.writeFileSync(path.join(OUT, "slack-message.json"), JSON.stringify({ blocks: buildSlackMessage(decision, { citations: c }) }, null, 2));
  await progress("decided", `${decision.findings.length} findings, chose "${decision.chosen_finding}"; citations ${citations.valid}/${citations.total}`);

  if (!opts.act) return { decision, citations, results: [] };

  const allowed = decision.options.filter((o) => checkPlan(o.files_to_change).ok);
  const results: OptionResult[] = await Promise.all(allowed.map(async (o) => {
    try {
      return await implementOption(decision, o);
    } catch (e) {
      return { option: o.id, branch: `johnny/option-${o.id.toLowerCase()}`, ok: false, summary: "", checks: (e as Error).message };
    }
  }));
  await progress("acted", results.map((r) => `${r.option}: ${r.ok ? `committed ${r.sha}` : "failed"}`).join(", "));

  const screen = decision.findings.find((f) => f.title === decision.chosen_finding)?.screen ?? "/";
  const shots = path.join(OUT, "shots");
  fs.mkdirSync(shots, { recursive: true });
  const beforeShot = path.join(shots, "before.png");
  await screenshot(ROOT, screen, beforeShot, 4301);
  let port = 4302;
  for (const r of results) {
    if (!r.ok) continue;
    r.shot = path.join(shots, `option-${r.option.toLowerCase()}.png`);
    await screenshot(path.join(ROOT, ".worktrees", `option-${r.option.toLowerCase()}`), screen, r.shot, port++);
  }
  fs.writeFileSync(path.join(OUT, "results.json"), JSON.stringify(results, null, 2));
  fs.writeFileSync(path.join(OUT, "thread.html"), buildThreadPage(decision, results, beforeShot, citations));
  await progress("verified", "screenshots and out/thread.html");
  return { decision, citations, results, beforeShot };
}
