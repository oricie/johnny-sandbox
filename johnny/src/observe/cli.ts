import { buildCodeGraph } from "./codeGraph";
import { loadKnowledge } from "./knowledge";
import { loadSignals } from "./signals";
import { buildEvidencePacks } from "../decide/evidence";

const graph = buildCodeGraph();
const knowledge = loadKnowledge();
const signals = loadSignals();

console.log("Routes:");
for (const r of graph.routes) console.log(`  ${r.path} -> ${r.file}`);
console.log("\nBackend routes:");
for (const b of graph.backend) console.log(`  ${b.route}  (${b.file}; uses ${b.uses.join(", ") || "-"})`);
console.log(`\nKnowledge docs: ${knowledge.map((k) => k.id).join(", ")}`);
console.log(`Signals: ${signals.length}\n`);

for (const p of buildEvidencePacks(graph, knowledge, signals)) {
  console.log(`== ${p.screen}  (${p.screenFile})`);
  console.log(`   components: ${p.components.join(", ")}`);
  console.log(`   api: ${p.apiCalls.join(", ") || "-"}`);
  console.log(`   backend: ${p.backendFiles.join(", ") || "-"}`);
  console.log(`   knowledge: ${p.knowledge.map((k) => k.id).join(", ")}`);
  console.log(`   protected: ${p.protectedFiles.join(", ") || "-"}`);
  console.log(`   signals: ${p.signals.map((s) => `${s.metric}=${typeof s.value === "string" ? JSON.stringify(s.value).slice(0, 50) : s.value}`).join(" | ")}\n`);
}
