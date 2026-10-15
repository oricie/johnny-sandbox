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

export type Intent = "chat" | "about" | "question" | "request" | "review";

// Routes a Slack message: small talk gets a short reply, questions get answered from
// what Johnny knows, change requests and reviews start a run (which costs minutes).
export async function classify(text: string): Promise<{ intent: Intent; reply: string }> {
  return structured(
    `You route messages sent to Johnny, a product design agent for the Sentinel SOC console.
intent:
- "review": asks Johnny to look over the product and find what to improve, with no specific change.
- "request": asks for a specific change to the product UI.
- "about": asks about Johnny himself: who he is, what he knows, what context or sources he has,
  what he is working on or has done.
- "question": asks about the product, its users, data, decisions or Johnny's reasoning.
- "chat": greetings, thanks, small talk, or anything else.
For "chat", write a one or two sentence reply in the message's language that says what Johnny can do
(review the product, answer questions about it, build a requested change). Otherwise reply is "".`,
    text,
    {
      type: "object", additionalProperties: false, required: ["intent", "reply"],
      properties: { intent: { type: "string", enum: ["chat", "about", "question", "request", "review"] }, reply: { type: "string" } },
    },
    "low",
  );
}

// What Johnny actually knows and is doing, gathered from the files, then phrased in the
// asker's language. Facts come from disk, not from the model.
export async function about(question: string, status: { busy: boolean; runs: number; lastFinding?: string; inbox: number }) {
  const { buildCodeGraph } = await import("../observe/codeGraph");
  const { loadKnowledge } = await import("../observe/knowledge");
  const { loadSignals } = await import("../observe/signals");
  const graph = buildCodeGraph();
  const knowledge = loadKnowledge();
  const analytics = JSON.parse(fs.readFileSync(path.join(ROOT, "context/analytics.json"), "utf8"));
  const facts = {
    product: "Sentinel, a SOC console (demo product in the johnny-sandbox repo)",
    code: { screens: graph.routes.map((r) => r.path), app_files: Object.keys(graph.nodes).length,
      api_routes: graph.backend.map((b) => b.route) },
    knowledge: knowledge.map((k) => `${k.id}: ${k.title}`),
    usage_data: { period: analytics.period, source: analytics.source, signals: loadSignals().length,
      feedback_quotes: analytics.feedback.length },
    guardrails: "can edit only demo-app components, screens and styles; API and rules are protected (constraints.json)",
    slack: { messages_heard_in_invited_channels: status.inbox, runs_since_start: status.runs, busy_now: status.busy,
      last_finding: status.lastFinding ?? "none yet" },
    not_yet: "no Gong, Zendesk or Jira connected; Slack messages are stored but not yet turned into knowledge",
  };
  const r = await structured<{ answer: string }>(
    `You are Johnny. Answer the teammate's question about yourself from the facts below only, in the
language of the question, in a few short lines of Slack mrkdwn (*bold*, bullets with •). Be concrete
(numbers, file names, sources). Be honest about what you don't have yet.`,
    `Question: ${question}\n\nFacts:\n${JSON.stringify(facts, null, 2)}`,
    { type: "object", additionalProperties: false, required: ["answer"], properties: { answer: { type: "string" } } },
    "low",
  );
  return r.answer;
}
