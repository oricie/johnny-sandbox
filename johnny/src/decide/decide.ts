import fs from "node:fs";
import path from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import { ROOT } from "../paths";
import type { EvidencePack } from "../types";

export const MODEL = "claude-opus-5-5";

export interface Decision {
  findings: {
    title: string;
    screen: string;
    impact: "high" | "medium" | "low";
    evidence: { claim: string; source: string }[];
    action: "fix_now" | "later" | "do_not_change";
    reason: string;
  }[];
  chosen_finding: string;
  options: {
    id: "A" | "B";
    name: string;
    approach: string;
    files_to_change: string[];
    pros: string[];
    cons: string[];
    risk: "low" | "medium" | "high";
  }[];
  recommendation: { option: "A" | "B"; why: string };
  constraints_respected: { rule: string; how: string }[];
}

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["findings", "chosen_finding", "options", "recommendation", "constraints_respected"],
  properties: {
    findings: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["title", "screen", "impact", "evidence", "action", "reason"],
        properties: {
          title: { type: "string" },
          screen: { type: "string" },
          impact: { type: "string", enum: ["high", "medium", "low"] },
          evidence: {
            type: "array",
            items: {
              type: "object", additionalProperties: false, required: ["claim", "source"],
              properties: { claim: { type: "string" }, source: { type: "string" } },
            },
          },
          action: { type: "string", enum: ["fix_now", "later", "do_not_change"] },
          reason: { type: "string" },
        },
      },
    },
    chosen_finding: { type: "string" },
    options: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "name", "approach", "files_to_change", "pros", "cons", "risk"],
        properties: {
          id: { type: "string", enum: ["A", "B"] },
          name: { type: "string" },
          approach: { type: "string" },
          files_to_change: { type: "array", items: { type: "string" } },
          pros: { type: "array", items: { type: "string" } },
          cons: { type: "array", items: { type: "string" } },
          risk: { type: "string", enum: ["low", "medium", "high"] },
        },
      },
    },
    recommendation: {
      type: "object", additionalProperties: false, required: ["option", "why"],
      properties: { option: { type: "string", enum: ["A", "B"] }, why: { type: "string" } },
    },
    constraints_respected: {
      type: "array",
      items: {
        type: "object", additionalProperties: false, required: ["rule", "how"],
        properties: { rule: { type: "string" }, how: { type: "string" } },
      },
    },
  },
} as const;

const SYSTEM = `You are Johnny, a product design agent working on an existing B2B product.
Nobody has told you what to fix. From the evidence packs and source files, find the UX problems,
rank them by user impact, and pick the one most worth fixing now.

Rules:
- Every claim cites a source: a repo-relative file path (with line if useful), a knowledge id like
  "decisions.md#D-12", or an analytics path like analytics.json#screens["/compare"]. Cite only sources you were given.
- Some friction is intentional. If a product decision explains a signal, mark it do_not_change and say which decision.
- Propose exactly two options, A and B, that take different approaches to the root cause, not two styles of the same idea.
- Options may only change files under demo-app/src/components, demo-app/src/screens or demo-app/src/styles.
  Use existing components and tokens from the design system.`;

function readSources(packs: EvidencePack[]) {
  const files = new Set(packs.flatMap((p) => [p.screenFile, ...p.components, ...p.backendFiles]));
  files.add("demo-app/src/styles/tokens.css");
  return [...files].map((f) => `--- ${f}\n${fs.readFileSync(path.join(ROOT, f), "utf8")}`).join("\n\n");
}

export async function decide(packs: EvidencePack[]): Promise<Decision> {
  // Claude Code cloud environments reserve ANTHROPIC_API_KEY for their own login and
  // don't pass it to sessions, so the demo reads JOHNNY_ANTHROPIC_KEY first.
  const apiKey = process.env.JOHNNY_ANTHROPIC_KEY ?? process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("Set JOHNNY_ANTHROPIC_KEY (or ANTHROPIC_API_KEY) to run the decide step");
  const client = new Anthropic({ apiKey });
  const response = await client.beta.messages.create({
    model: MODEL,
    max_tokens: 16000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    system: SYSTEM,
    output_config: { effort: "high", format: { type: "json_schema", schema: SCHEMA } },
    messages: [{
      role: "user",
      content: `Evidence packs:\n${JSON.stringify(packs, null, 2)}\n\nSource files:\n${readSources(packs)}`,
    }],
  });

  if (response.stop_reason === "refusal") throw new Error("Model declined the request");
  const text = response.content.find((b) => b.type === "text");
  if (!text || text.type !== "text") throw new Error(`No text in response (stop_reason=${response.stop_reason})`);
  return JSON.parse(text.text) as Decision;
}
