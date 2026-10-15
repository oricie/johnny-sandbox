import { buildCodeGraph } from "./observe/codeGraph";
import { checkPlan } from "./guard/constraints";
import { runJohnny } from "./pipeline";

// Flags:
//   --observe-only        stop after observe
//   --decision <file>     reuse a saved decision instead of calling the model to decide
//   --request "<text>"    request mode: a teammate's ask instead of Johnny's own review
//   --act                 implement both options in worktrees, check, screenshot, write out/thread.html
const args = process.argv.slice(2);
const value = (name: string) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const t0 = Date.now();
const lap = (label: string) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s] ${label}`);

if (args.includes("--observe-only")) {
  const g = buildCodeGraph();
  lap(`observe: ${Object.keys(g.nodes).length} files, ${g.routes.length} screens`);
  process.exit(0);
}

const { decision, results } = await runJohnny({
  request: value("--request"),
  decisionFile: value("--decision"),
  act: args.includes("--act"),
  onProgress: (stage, detail) => lap(`${stage}: ${detail}`),
});
for (const o of decision.options) {
  const plan = checkPlan(o.files_to_change);
  console.log(`  option ${o.id} plan: ${plan.ok ? "ok" : `REJECTED, touches ${plan.violations.join(", ")}`}`);
}
if (decision.request) console.log(`  request verdict: ${decision.request.verdict}: ${decision.request.explanation}`);
for (const r of results) {
  const dev = r.deviations?.length ? `; outside the plan: ${r.deviations.join(", ")}` : "";
  console.log(`  act ${r.option}: ${r.ok ? `committed ${r.sha} on ${r.branch}${dev}` : `failed: ${r.checks.slice(0, 300)}`}`);
}
