import type Anthropic from "@anthropic-ai/sdk";
import { client, MODEL, imageBlocks } from "../llm";
import { CHARTER } from "../charter";
import { TOOL_DEFS, runTool, type AgentHooks } from "./tools";

export interface Turn { role: "user" | "assistant"; text: string; name?: string; images?: string[] }

const SYSTEM = `${CHARTER}

---

You are in a Slack conversation with the product team. Talk like a thoughtful teammate: answer what was
asked, use your tools to check before you claim. Use the conversation so far; "it" and "that" refer to
what was discussed.

Reply in the language of the person's most recent message, even if earlier messages or your tools are in
another language. Keep it short: usually 3 to 8 lines, the answer first. Offer more detail instead of
writing it all. Slack mrkdwn only: *bold*, • bullets, no headings.

People may attach images: a screenshot of a problem, a sketch or mockup, another product. Look at them
and say what you see and take from them. When you start a request, the thread's images go with it.

Starting a review or a build takes minutes and costs money: do it only when the person asks for it or
clearly agrees. When they're discussing or asking, discuss and answer. After you start one, say so in a
sentence; the results arrive in the thread on their own.`;

type Msg = Anthropic.Beta.BetaMessageParam;

// One reply to a Slack conversation: a tool-use loop until Johnny has an answer.
export async function reply(history: Turn[], hooks: AgentHooks): Promise<string> {
  // Slack threads can start with Johnny or have several messages in a row from one side.
  // Only the most recent images go to the model; older ones are mentioned by name.
  const recent = new Set(history.flatMap((t) => t.images ?? []).slice(-4));
  const messages: Msg[] = [];
  for (const t of history) {
    const text = (t.role === "user" && t.name ? `${t.name}: ${t.text}` : t.text) || "(image)";
    const imgs = (t.images ?? []).filter((f) => recent.has(f));
    const older = (t.images ?? []).filter((f) => !recent.has(f));
    const blocks: Anthropic.Beta.BetaContentBlockParam[] = [
      ...imageBlocks(imgs),
      { type: "text", text: text + (older.length ? `\n(earlier images: ${older.length})` : "") },
    ];
    const last = messages.at(-1);
    if (last && last.role === t.role && Array.isArray(last.content)) (last.content as Anthropic.Beta.BetaContentBlockParam[]).push(...blocks);
    else messages.push({ role: t.role, content: t.role === "assistant" ? text : blocks });
  }
  while (messages.length && messages[0].role !== "user") messages.shift();
  if (!messages.length) return "";

  for (let step = 0; step < 10; step++) {
    const response = await client().beta.messages.stream({
      model: MODEL,
      max_tokens: 16000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      system: SYSTEM,
      output_config: { effort: "medium" },
      tools: TOOL_DEFS as unknown as Anthropic.Beta.BetaTool[],
      messages,
    }).finalMessage();

    if (response.stop_reason === "refusal") return "I can't help with that one.";
    messages.push({ role: "assistant", content: response.content });
    const uses = response.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use");
    if (response.stop_reason !== "tool_use" || !uses.length) {
      return response.content.filter((b) => b.type === "text").map((b) => (b as { text: string }).text).join("\n").trim();
    }
    const results = await Promise.all(uses.map(async (u) => ({
      type: "tool_result" as const,
      tool_use_id: u.id,
      content: await runTool(u.name, u.input as Record<string, unknown>, hooks).catch((e) => `Error: ${(e as Error).message}`),
    })));
    messages.push({ role: "user", content: results });
  }
  return "I went around in circles on that one. Can you say it another way?";
}
