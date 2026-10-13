import fs from "node:fs";
import path from "node:path";
import { ROOT } from "../paths";
import type { KnowledgeDoc } from "../types";
import type { Decision } from "../decide/decide";

// Checks that every cited source actually exists. A finding whose evidence
// can't be traced back is reported, not silently trusted.
export function checkCitations(decision: Decision, knowledge: KnowledgeDoc[]) {
  const ids = new Set(knowledge.map((k) => k.id));
  const analytics = fs.readFileSync(path.join(ROOT, "context/analytics.json"), "utf8");

  const valid = (source: string) => {
    if (ids.has(source)) return true;
    if (source.startsWith("analytics.json")) {
      const screen = /screens\["([^"]+)"\]/.exec(source)?.[1];
      return screen ? analytics.includes(`"${screen}"`) : /feedback\[\d+\]|^analytics\.json$/.test(source);
    }
    const file = source.split(":")[0];
    return fs.existsSync(path.join(ROOT, file));
  };

  const invalid = decision.findings.flatMap((f) => f.evidence.filter((e) => !valid(e.source)).map((e) => ({ finding: f.title, ...e })));
  const total = decision.findings.reduce((n, f) => n + f.evidence.length, 0);
  return { total, invalid };
}
