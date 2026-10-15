import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { ROOT, OUT } from "../paths";
import { buildCodeGraph } from "../observe/codeGraph";
import { loadKnowledge } from "../observe/knowledge";

// What Johnny can look at or start during a conversation. Reading is limited to the product,
// its context and the guardrails; starting work goes through the same pipeline as everything else.
const READABLE = ["context/", "demo-app/src/", "demo-api/src/", "constraints.json", "johnny/CHARTER.md"];

export interface AgentHooks {
  startRun: (request?: string) => Promise<string>; // starts a review or request run; results go to the thread
  status: () => { busy: boolean; runs: number; lastFinding?: string };
}

export const TOOL_DEFS = [
  {
    name: "overview",
    description: "Map of what Johnny knows: the product's screens and the files behind each, API routes, knowledge docs and decisions, and the usage data period. Use it first when you need to find your way around.",
    input_schema: { type: "object", additionalProperties: false, properties: {}, required: [] },
  },
  {
    name: "read_file",
    description: "Read a file from the product (demo-app/src, demo-api/src), its context (context/*.md, context/analytics.json), constraints.json or your charter. Returns the file with line numbers.",
    input_schema: { type: "object", additionalProperties: false, required: ["path"],
      properties: { path: { type: "string", description: "Repo-relative path, e.g. context/decisions.md" } } },
  },
  {
    name: "search",
    description: "Search the product code and context for a word or phrase (case-insensitive). Returns matching lines with file:line.",
    input_schema: { type: "object", additionalProperties: false, required: ["query"],
      properties: { query: { type: "string" } } },
  },
  {
    name: "team_chatter",
    description: "The latest messages people wrote in Slack channels you are invited to (what you've heard so far).",
    input_schema: { type: "object", additionalProperties: false, required: [], properties: { limit: { type: "integer" } } },
  },
  {
    name: "status",
    description: "Whether you are in the middle of a run, how many runs you've done, and your last finding.",
    input_schema: { type: "object", additionalProperties: false, properties: {}, required: [] },
  },
  {
    name: "start_review",
    description: "Start your own review of the product: find the most important problem, propose two options, build both in branches, check and screenshot them. Takes 2-3 minutes; results are posted to this thread automatically. Only when the person wants a review.",
    input_schema: { type: "object", additionalProperties: false, properties: {}, required: [] },
  },
  {
    name: "start_request",
    description: "Start work on a specific change the person asked for: check it against decisions, propose two options (or push back with alternatives), build, check and screenshot. Images attached in this thread are passed along automatically, and the result is compared against them. Takes 2-3 minutes; results are posted to this thread. Only when the person clearly wants the change built, not when they are still discussing.",
    input_schema: { type: "object", additionalProperties: false, required: ["request"],
      properties: { request: { type: "string", description: "The change, written as a clear brief including what was agreed in this conversation" } } },
  },
] as const;

const numbered = (text: string) => text.split("\n").map((l, i) => `${i + 1}| ${l}`).join("\n");

export async function runTool(name: string, input: Record<string, unknown>, hooks: AgentHooks): Promise<string> {
  switch (name) {
    case "overview": {
      const g = buildCodeGraph();
      const analytics = JSON.parse(fs.readFileSync(path.join(ROOT, "context/analytics.json"), "utf8"));
      return JSON.stringify({
        product: "Sentinel, a SOC console",
        screens: g.routes.map((r) => ({ path: r.path, file: r.file })),
        api: g.backend.map((b) => `${b.route} (${b.file}${b.uses.length ? `, uses ${b.uses.join(", ")}` : ""})`),
        knowledge: loadKnowledge().map((k) => ({ id: k.id, title: k.title, scope: k.scope })),
        usage_data: { file: "context/analytics.json", period: analytics.period, source: analytics.source },
        not_connected_yet: ["Gong", "Zendesk", "Jira"],
      }, null, 2);
    }
    case "read_file": {
      const p = String(input.path ?? "").replace(/^\/+/, "");
      if (p.includes("..") || !READABLE.some((r) => p === r || p.startsWith(r))) return `Not readable: ${p}. Allowed: ${READABLE.join(", ")}`;
      const abs = path.join(ROOT, p);
      return fs.existsSync(abs) ? numbered(fs.readFileSync(abs, "utf8")).slice(0, 40_000) : `No such file: ${p}`;
    }
    case "search": {
      try {
        return execFileSync("grep", ["-rniI", "--", String(input.query ?? ""), "demo-app/src", "demo-api/src", "context"],
          { cwd: ROOT, encoding: "utf8" }).split("\n").slice(0, 60).join("\n") || "No matches";
      } catch { return "No matches"; }
    }
    case "team_chatter": {
      const f = path.join(OUT, "slack-inbox.jsonl");
      if (!fs.existsSync(f)) return "Nothing heard yet.";
      const n = Math.min(Number(input.limit ?? 20), 100);
      return fs.readFileSync(f, "utf8").trim().split("\n").slice(-n).join("\n");
    }
    case "status":
      return JSON.stringify(hooks.status());
    case "start_review":
      return hooks.startRun();
    case "start_request":
      return hooks.startRun(String(input.request ?? ""));
    default:
      return `Unknown tool ${name}`;
  }
}
