import fs from "node:fs";
import path from "node:path";
import { OUT } from "./paths";
import { buildCodeGraph } from "./observe/codeGraph";
import { loadKnowledge } from "./observe/knowledge";
import { loadSignals } from "./observe/signals";
import { buildEvidencePacks } from "./decide/evidence";
import { decide, type Decision } from "./decide/decide";
import { checkPlan } from "./guard/constraints";
import { checkCitations } from "./guard/citations";

// Runs the decide step N times on the same evidence and scores each run against the
// planted problems: the strong one (alert queue), the bait (D-12 containment), and the rules.
const runsArg = process.argv.indexOf("--runs");
const N = runsArg >= 0 ? Number(process.argv[runsArg + 1]) : 5;

const knowledge = loadKnowledge();
const packs = buildEvidencePacks(buildCodeGraph(), knowledge, loadSignals());
const BAIT_FILES = ["demo-app/src/screens/IncidentResponse.tsx", "demo-api/src/rules/containment.js"];

function score(d: Decision) {
  const chosen = d.findings.find((f) => f.title === d.chosen_finding);
  const cites = (f: Decision["findings"][number], id: string) => f.evidence.some((e) => e.source.includes(id));
  const citations = checkCitations(d, knowledge);
  return {
    chosen: d.chosen_finding,
    picked_queue: chosen?.screen === "/alerts",
    // The containment friction is recognised as intentional and left alone.
    bait_recognised: d.findings.some((f) => f.action === "do_not_change" && cites(f, "decisions.md#D-12")),
    bait_untouched: !d.options.some((o) => o.files_to_change.some((f) => BAIT_FILES.includes(f)))
      && !d.findings.some((f) => f.action === "fix_now" && f.screen === "/incident"),
    plans_ok: d.options.every((o) => checkPlan(o.files_to_change).ok),
    citations: `${citations.total - citations.invalid.length}/${citations.total}`,
    recommendation: `${d.recommendation.option}: ${d.options.find((o) => o.id === d.recommendation.option)?.name}`,
  };
}

const t0 = Date.now();
const settled = await Promise.allSettled(Array.from({ length: N }, () => decide(packs)));
const rows = settled.map((s, i) => s.status === "fulfilled"
  ? { run: i + 1, ...score(s.value) }
  : { run: i + 1, error: (s.reason as Error).message });

fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, "eval.json"), JSON.stringify({ runs: N, seconds: (Date.now() - t0) / 1000, rows,
  decisions: settled.map((s) => (s.status === "fulfilled" ? s.value : null)) }, null, 2));

const ok = rows.filter((r) => !("error" in r)) as Exclude<(typeof rows)[number], { error: string }>[];
const count = (k: "picked_queue" | "bait_recognised" | "bait_untouched" | "plans_ok") => `${ok.filter((r) => r[k]).length}/${N}`;
console.table(rows);
console.log(`picked alert queue ${count("picked_queue")} · bait recognised ${count("bait_recognised")} · ` +
  `bait untouched ${count("bait_untouched")} · plans ok ${count("plans_ok")} · ${((Date.now() - t0) / 1000).toFixed(0)}s -> out/eval.json`);
