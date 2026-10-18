import fs from "node:fs";
import path from "node:path";
import { ROOT } from "../paths";
import { investigate } from "../target/investigateCore";
import type { RouteInfo } from "../target/graph";
import type { EvidencePack, KnowledgeDoc } from "../types";
import type { Decision } from "./decide";

// Johnny's own review of the product, by investigation: he gets the product's knowledge
// (decisions, personas, what he learned) and usage signals up front, plus the route map,
// and pulls code as he checks each suspicion. Same rules as decide().
const RULES = `
Besides code, you may cite:
- a knowledge id exactly as given, e.g. "decisions.md#D-12" or "product.md";
- an analytics path exactly as given in the signals, e.g. analytics.json#screens["/alerts"].events.open_alert.
Knowledge ids starting with "learned#" are what you learned from customer calls, tickets, research and
Slack. An "OPEN CONFLICT" means a written decision may be out of date: do not act on the unconfirmed side,
and say the conflict must be resolved by a person first.
If a product decision explains a signal, mark it do_not_change and say which decision.
Options may only change files under demo-app/src/components, demo-app/src/screens or demo-app/src/styles.
Use existing components and tokens from the design system.`;

export async function decideByInvestigation(packs: EvidencePack[], knowledge: KnowledgeDoc[],
  onStep?: (line: string) => void): Promise<Decision & { investigation: { steps: number; files: number; invalid: string[] } }> {
  const lines = (f: string) => fs.readFileSync(path.join(ROOT, f), "utf8").split("\n").length;
  const routes: RouteInfo[] = packs.map((p) => {
    const files = [p.screenFile, ...p.components, ...p.backendFiles];
    return { route: p.screen, page: p.screenFile, files, lines: files.reduce((n, f) => n + lines(f), 0) };
  });
  const signals = packs.flatMap((p) => p.signals.map((s) => ({ screen: s.screen, metric: s.metric, value: s.value, detail: s.detail, source: s.source })));
  const intro = `Knowledge:\n${knowledge.map((k) => `### ${k.id} (${k.type}): ${k.title}\n${k.body}`).join("\n\n")}` +
    `\n\nUsage signals:\n${JSON.stringify(signals, null, 1)}`;

  const ids = new Set(knowledge.map((k) => k.id));
  const analytics = fs.readFileSync(path.join(ROOT, "context/analytics.json"), "utf8");
  const validNonFile = (s: string) => {
    if (ids.has(s)) return true;
    if (s.startsWith("analytics.json")) {
      const screen = /screens\["([^"]+)"\]/.exec(s)?.[1];
      return screen ? analytics.includes(`"${screen}"`) : /feedback\[\d+\]|^analytics\.json$/.test(s);
    }
    if (/^[\w-]+\.md(#|$)/.test(s) || s.startsWith("learned#")) return false; // a knowledge id he wasn't given
    return undefined;
  };

  const inv = await investigate({ root: ROOT, routes, intro, rules: RULES, maxSteps: 25, validNonFile, onStep });
  return { ...inv.decision, investigation: { steps: inv.steps, files: Object.keys(inv.filesRead).length,
    invalid: inv.citations.filter((c) => !c.ok).map((c) => c.source) } };
}
