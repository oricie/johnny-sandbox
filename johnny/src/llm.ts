import Anthropic from "@anthropic-ai/sdk";

export const MODEL = "claude-opus-5-5";

// Claude Code cloud environments reserve ANTHROPIC_API_KEY for their own login and
// don't pass it to sessions, so the demo reads JOHNNY_ANTHROPIC_KEY first.
export function client() {
  const apiKey = process.env.JOHNNY_ANTHROPIC_KEY ?? process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("Set JOHNNY_ANTHROPIC_KEY (or ANTHROPIC_API_KEY) to call the model");
  return new Anthropic({ apiKey });
}

// One structured call: system + user text in, JSON matching `schema` out.
export async function structured<T>(system: string, user: string, schema: Record<string, unknown>): Promise<T> {
  const response = await client().beta.messages.create({
    model: MODEL,
    max_tokens: 32000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    system,
    output_config: { effort: "high", format: { type: "json_schema", schema } },
    messages: [{ role: "user", content: user }],
  });
  if (response.stop_reason === "refusal") throw new Error("Model declined the request");
  if (response.stop_reason === "max_tokens") throw new Error("Model output was cut off (max_tokens)");
  const text = response.content.find((b) => b.type === "text");
  if (!text || text.type !== "text") throw new Error(`No text in response (stop_reason=${response.stop_reason})`);
  return JSON.parse(text.text) as T;
}
