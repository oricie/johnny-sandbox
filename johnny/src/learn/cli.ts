import { learn } from "./learn";

const t0 = Date.now();
const r = await learn((s) => console.log(`[${((Date.now() - t0) / 1000).toFixed(0)}s] ${s}`));
console.log(`[${((Date.now() - t0) / 1000).toFixed(0)}s] ${r.newSources} new sources, ${r.newEntries} new entries, ${r.newConflicts} new conflicts -> knowledge/learned.json\n`);
for (const e of r.knowledge.entries) {
  console.log(`${e.id} [${e.type}, ${e.strength}] ${e.title}  (${e.screens.join(", ") || "-"}; ${e.evidence.length} evidence, ${e.accounts.join(", ")})`);
}
for (const c of r.knowledge.conflicts) console.log(`\n⚠ ${c.id} ${c.decision} vs ${c.entry}: ${c.summary}\n   Q: ${c.question}`);
