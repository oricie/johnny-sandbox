import fs from "node:fs";
import path from "node:path";
import { ROOT } from "../paths";
import { structured, imageBlocks } from "../llm";

// After building an option, Johnny looks at the screenshot of what he built and checks it against what
// he wrote about it and against the product's decisions. What he says must match what people will see;
// a mismatch is reported, not smoothed over.
export interface SelfCheck { ok: boolean; issues: string[] }

export async function selfCheck(option: string, summary: string, shot: string): Promise<SelfCheck> {
  const decisions = fs.readFileSync(path.join(ROOT, "context/decisions.md"), "utf8");
  return structured<SelfCheck>(
    `You built option ${option} of a change and wrote a summary of it. Look at the screenshot of the built screen.
List every claim in the summary that the screenshot contradicts, and anything visible that breaks one of the
product decisions below. Only judge what's visible: the screenshot shows the first screen only, so something
out of view is not a mismatch. ok=true only if there are no issues. Each issue: one plain sentence, in the
user's terms, saying what the summary or decision says and what the screen shows.`,
    [...imageBlocks([shot]), { type: "text", text: `Summary of option ${option}:\n${summary}\n\nProduct decisions:\n${decisions}` }],
    { type: "object", additionalProperties: false, required: ["ok", "issues"],
      properties: { ok: { type: "boolean" }, issues: { type: "array", items: { type: "string" } } } },
    "medium",
  );
}
