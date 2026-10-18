import fs from "node:fs";
import path from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import { CHARTER } from "./charter";

export const MODEL = "claude-opus-5-5";

// Claude Code cloud environments reserve ANTHROPIC_API_KEY for their own login and
// don't pass it to sessions, so the demo reads JOHNNY_ANTHROPIC_KEY first.
export function client() {
  const apiKey = process.env.JOHNNY_ANTHROPIC_KEY ?? process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("Set JOHNNY_ANTHROPIC_KEY (or ANTHROPIC_API_KEY) to call the model");
  return new Anthropic({ apiKey });
}

// One structured call: system + user text in, JSON matching `schema` out.
// Streamed, because whole-file edits can be long and the SDK refuses large non-streaming requests.
export type UserContent = string | Anthropic.Beta.BetaContentBlockParam[];

// Images on disk as content blocks, placed before the text that refers to them.
export function imageBlocks(files: string[] = []): Anthropic.Beta.BetaContentBlockParam[] {
  const type = (f: string) => (/\.jpe?g$/i.test(f) ? "image/jpeg" : /\.gif$/i.test(f) ? "image/gif" : /\.webp$/i.test(f) ? "image/webp" : "image/png");
  return files.flatMap((f, i) => [
    { type: "text" as const, text: `Image ${i + 1} (${path.basename(f)}):` },
    { type: "image" as const, source: { type: "base64" as const, media_type: type(f), data: fs.readFileSync(f).toString("base64") } },
  ]);
}

// Running token totals for every structured call in this process, for cost reporting.
export const usage = { calls: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
// claude-opus-5-5 list prices, $ per million tokens (cache reads $0.20, writes 1.25x input).
export const costUSD = () =>
  (usage.input * 4 + usage.output * 20 + usage.cacheRead * 0.2 + usage.cacheWrite * 5) / 1e6;

export function track(response: Anthropic.Beta.BetaMessage) {
  usage.calls++;
  usage.input += response.usage.input_tokens;
  usage.output += response.usage.output_tokens;
  usage.cacheRead += response.usage.cache_read_input_tokens ?? 0;
  usage.cacheWrite += response.usage.cache_creation_input_tokens ?? 0;
}

export async function structured<T>(system: string, user: UserContent, schema: Record<string, unknown>,
  effort: "low" | "medium" | "high" = "high"): Promise<T> {
  const response = await client().beta.messages.stream({
    model: MODEL,
    max_tokens: 64000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    system: `${CHARTER}\n\n---\n\n${system}`,
    output_config: { effort, format: { type: "json_schema", schema } },
    messages: [{ role: "user", content: user }],
  }).finalMessage();
  track(response);
  if (response.stop_reason === "refusal") throw new Error("Model declined the request");
  if (response.stop_reason === "max_tokens") throw new Error("Model output was cut off (max_tokens)");
  const text = response.content.find((b) => b.type === "text");
  if (!text || text.type !== "text") throw new Error(`No text in response (stop_reason=${response.stop_reason})`);
  return JSON.parse(text.text) as T;
}
