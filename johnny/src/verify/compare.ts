import { structured, imageBlocks } from "../llm";

export interface Comparison { option: string; matches: string[]; gaps: string[]; deliberate: string[]; verdict: string }

// Johnny checks his own work: the reference image(s) next to the screenshot of each option.
// "deliberate" is where he departed from the reference on purpose (design system, a decision).
export async function compareToReference(references: string[], shots: { option: string; file: string }[], brief: string): Promise<Comparison[]> {
  if (!references.length || !shots.length) return [];
  const r = await structured<{ options: Comparison[] }>(
    `Compare what you built with the reference image(s) the teammate gave you. For each option list what
matches, what is missing or different (gaps), and where you departed on purpose because of the design
system or a product decision (deliberate). End with a one-line verdict per option. Be specific and brief.
Write in the language of the brief.`,
    [
      ...imageBlocks(references),
      { type: "text", text: `Those are the reference image(s). The brief was: ${brief}\n\nNext, the screenshots of what you built:` },
      ...shots.flatMap((s) => [{ type: "text" as const, text: `Option ${s.option}:` }, ...imageBlocks([s.file]).slice(1)]),
    ],
    {
      type: "object", additionalProperties: false, required: ["options"],
      properties: { options: { type: "array", items: {
        type: "object", additionalProperties: false, required: ["option", "matches", "gaps", "deliberate", "verdict"],
        properties: {
          option: { type: "string" }, verdict: { type: "string" },
          matches: { type: "array", items: { type: "string" } },
          gaps: { type: "array", items: { type: "string" } },
          deliberate: { type: "array", items: { type: "string" } },
        } } } },
    },
    "medium",
  );
  // The model sometimes writes "Option A" where the id "A" is expected.
  return r.options.map((o) => ({ ...o, option: o.option.replace(/^option\s+/i, "") }));
}
