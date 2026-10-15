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

export type Intent = "chat" | "question" | "request" | "review";

// Routes a Slack message: small talk gets a short reply, questions get answered from
// what Johnny knows, change requests and reviews start a run (which costs minutes).
export async function classify(text: string): Promise<{ intent: Intent; reply: string }> {
  return structured(
    `You route messages sent to Johnny, a product design agent for the Sentinel SOC console.
intent:
- "review": asks Johnny to look over the product and find what to improve, with no specific change.
- "request": asks for a specific change to the product UI.
- "question": asks about the product, its users, data, decisions or Johnny's reasoning.
- "chat": greetings, thanks, small talk, or anything else.
For "chat", write a one or two sentence reply in the message's language that says what Johnny can do
(review the product, answer questions about it, build a requested change). Otherwise reply is "".`,
    text,
    {
      type: "object", additionalProperties: false, required: ["intent", "reply"],
      properties: { intent: { type: "string", enum: ["chat", "question", "request", "review"] }, reply: { type: "string" } },
    },
    "low",
  );
}
