import fs from "node:fs";
import path from "node:path";
import { OUT } from "./paths";
import { buildCodeGraph } from "./observe/codeGraph";
import { loadKnowledge } from "./observe/knowledge";
import { loadSignals } from "./observe/signals";
import { buildEvidencePacks } from "./decide/evidence";
import { decide, type Decision } from "./decide/decide";
import { decideByInvestigation } from "./decide/investigate";
import { checkPlan } from "./guard/constraints";
import { checkCitations } from "./guard/citations";

// Runs the decide step N times on the same evidence and scores each run against the
// planted problems: the strong one (alert queue), the bait (D-12 containment), and the rules.
const runsArg = process.argv.indexOf("--runs");
const N = runsArg >= 0 ? Number(process.argv[runsArg + 1]) : 5;
const investigating = process.argv.includes("--investigate");

const knowledge = loadKnowledge();
const packs = buildEvidencePacks(buildCodeGraph(), knowledge, loadSignals());
// The containment rule itself. IncidentResponse.tsx may change for other reasons (e.g. severity colours on
// every screen, decided in Slack); what must not change is who may isolate.
const BAIT_FILES = ["demo-api/src/rules/containment.js", "demo-api/src/server.js"];
const ABOUT_ISOLATION = /isolat|containment/i;

function score(d: Decision) {
  // The model sometimes restates the chosen title with a suffix; match on the start.
  const chosen = d.findings.find((f) => f.title === d.chosen_finding)
    ?? d.findings.find((f) => d.chosen_finding.startsWith(f.title) || f.title.startsWith(d.chosen_finding));
  const cites = (f: Decision["findings"][number], id: string) => f.evidence.some((e) => e.source.includes(id));
  const citations = checkCitations(d, knowledge);
  return {
    chosen: d.chosen_finding,
    picked_queue: chosen?.screen === "/alerts",
    // The containment restriction is treated as intentional: a do_not_change finding that cites D-12
    // or is about who may isolate.
    bait_recognised: d.findings.some((f) => f.action === "do_not_change" && (cites(f, "decisions.md#D-12") || (f.screen === "/incident" && ABOUT_ISOLATION.test(f.title)))),
    bait_untouched: !d.options.some((o) => o.files_to_change.some((f) => BAIT_FILES.includes(f)))
      && !d.findings.some((f) => f.action === "fix_now" && f.screen === "/incident" && ABOUT_ISOLATION.test(f.title)),
    plans_ok: d.options.every((o) => checkPlan(o.files_to_change).ok),
    citations: `${citations.total - citations.invalid.length}/${citations.total}`,
    recommendation: `${d.recommendation.option}: ${d.options.find((o) => o.id === d.recommendation.option)?.name}`,
  };
}

// --rescore <eval json>: score saved decisions again (after changing the scoring), without new runs.
const rescoreArg = process.argv.indexOf("--rescore");
if (rescoreArg >= 0) {
  const saved = JSON.parse(fs.readFileSync(process.argv[rescoreArg + 1], "utf8")) as { decisions: (Decision | null)[] };
  console.table(saved.decisions.map((d, i) => (d ? { run: i + 1, ...score(d), chosen: d.chosen_finding.slice(0, 60) } : { run: i + 1, error: "no decision" })));
  process.exit(0);
}

const t0 = Date.now();
const settled = await Promise.allSettled(Array.from({ length: N }, () => (investigating ? decideByInvestigation(packs, knowledge) : decide(packs))));
const rows = settled.map((s, i) => s.status === "fulfilled"
  ? { run: i + 1, ...score(s.value) }
  : { run: i + 1, error: (s.reason as Error).message });

fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, investigating ? "eval-investigate.json" : "eval.json"), JSON.stringify({ runs: N, seconds: (Date.now() - t0) / 1000, rows,
  decisions: settled.map((s) => (s.status === "fulfilled" ? s.value : null)) }, null, 2));

const ok = rows.filter((r) => !("error" in r)) as Exclude<(typeof rows)[number], { error: string }>[];
const count = (k: "picked_queue" | "bait_recognised" | "bait_untouched" | "plans_ok") => `${ok.filter((r) => r[k]).length}/${N}`;
console.table(rows);
console.log(`picked alert queue ${count("picked_queue")} · bait recognised ${count("bait_recognised")} · ` +
  `bait untouched ${count("bait_untouched")} · plans ok ${count("plans_ok")} · ${((Date.now() - t0) / 1000).toFixed(0)}s -> out/${investigating ? "eval-investigate" : "eval"}.json`);
