import fs from "node:fs";
import path from "node:path";
import { OUT } from "./paths";
import { buildCodeGraph } from "./observe/codeGraph";
import { loadKnowledge } from "./observe/knowledge";
import { loadSignals } from "./observe/signals";
import { buildEvidencePacks } from "./decide/evidence";
import { decide } from "./decide/decide";
import { checkPlan } from "./guard/constraints";
import { checkCitations } from "./guard/citations";
import { buildSlackMessage } from "./report/slack";

const t0 = Date.now();
const lap = (label: string) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s] ${label}`);

const graph = buildCodeGraph();
const knowledge = loadKnowledge();
const signals = loadSignals();
const packs = buildEvidencePacks(graph, knowledge, signals);
fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, "evidence.json"), JSON.stringify({ graph, packs }, null, 2));
lap(`observe: ${Object.keys(graph.nodes).length} files, ${packs.length} screens, ${signals.length} signals -> out/evidence.json`);

if (!process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_AUTH_TOKEN) {
  console.log("\nNo ANTHROPIC_API_KEY set. Stopping after observe; evidence is in out/evidence.json.");
  process.exit(0);
}

const decision = await decide(packs);
fs.writeFileSync(path.join(OUT, "decision.json"), JSON.stringify(decision, null, 2));
lap(`decide: ${decision.findings.length} findings, chose "${decision.chosen_finding}"`);

for (const o of decision.options) {
  const plan = checkPlan(o.files_to_change);
  console.log(`  option ${o.id} plan: ${plan.ok ? "ok" : `REJECTED, touches ${plan.violations.join(", ")}`}`);
}
const citations = checkCitations(decision, knowledge);
lap(`citations: ${citations.total - citations.invalid.length}/${citations.total} valid`);

const blocks = buildSlackMessage(decision, { citations });
fs.writeFileSync(path.join(OUT, "slack-message.json"), JSON.stringify({ blocks }, null, 2));
lap("report: out/slack-message.json (paste into Block Kit Builder to preview)");
