import fs from "node:fs";
import path from "node:path";
import { ROOT } from "../paths";
import { structured } from "../llm";

// Answers a teammate's question from what Johnny knows: product docs, decisions, personas,
// design system and usage data. Every point cites its source; unknowns are said plainly.
export async function ask(question: string): Promise<{ answer: string; sources: string[] }> {
  const ctx = fs.readdirSync(path.join(ROOT, "context"))
    .map((f) => `--- context/${f}\n${fs.readFileSync(path.join(ROOT, "context", f), "utf8")}`).join("\n\n");
  return structured(
    `You are Johnny, a product design agent who knows this product. Answer the teammate's question from the
material below only. Be brief (a few sentences), cite sources inline like (decisions.md#D-12), and list
them in "sources". If the material doesn't answer it, say so. Answer in the language of the question.
Use Slack mrkdwn (*bold*), not Markdown headings.`,
    `Question: ${question}\n\n${ctx}`,
    {
      type: "object", additionalProperties: false, required: ["answer", "sources"],
      properties: { answer: { type: "string" }, sources: { type: "array", items: { type: "string" } } },
    },
  );
}
