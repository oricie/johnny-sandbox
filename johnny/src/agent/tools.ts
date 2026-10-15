import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { ROOT, OUT } from "../paths";
import { buildCodeGraph } from "../observe/codeGraph";
import { loadKnowledge } from "../observe/knowledge";
import { learn, loadLearned } from "../learn/learn";

// What Johnny can look at or start during a conversation. Reading is limited to the product,
// its context and the guardrails; starting work goes through the same pipeline as everything else.
const READABLE = ["context/", "demo-app/src/", "demo-api/src/", "constraints.json", "johnny/CHARTER.md"];

export interface AgentHooks {
  startRun: (request?: string) => Promise<string>; // starts a review or request run; results go to the thread
  startPrototype: (brief: string, variants: number) => Promise<string>; // exploration prototypes; results go to the thread
  sketch: (change: string, route: string) => Promise<string>; // quick visual mockup, posted to the thread
  status: () => Record<string, unknown>;
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
    name: "learned",
    description: "What you learned from customer calls (Gong), support tickets (Zendesk), usability research and Slack: knowledge entries with quotes, accounts and strength, and open conflicts with written decisions. Filter by screen route and/or a search term.",
    input_schema: { type: "object", additionalProperties: false, required: [],
      properties: { screen: { type: "string", description: "e.g. /alerts" }, query: { type: "string" } } },
  },
  {
    name: "learn_now",
    description: "Read new sources (calls, tickets, research, and what you heard in Slack) and update your knowledge. Takes about a minute. Use when asked to learn or catch up, or when new material was shared.",
    input_schema: { type: "object", additionalProperties: false, properties: {}, required: [] },
  },
  {
    name: "status",
    description: "Whether you are in the middle of a run, your last finding, and for this thread: the finding, the live links (today and each option), branches, changed files and what you changed. Use it when people ask about the options you built here.",
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
  {
    name: "sketch",
    description: "Quick visual sketch (about 30 seconds) of how a screen would look after a change: edits the screen's real HTML and posts a screenshot to the thread. Static, no checks, nothing built. Use it to show a visual change before spending minutes on a full build, then ask whether to build it.",
    input_schema: { type: "object", additionalProperties: false, required: ["change", "route"],
      properties: {
        change: { type: "string", description: "The visual change, concretely" },
        route: { type: "string", description: "Screen route, e.g. /alerts, /incident, /overview" },
      } },
  },
  {
    name: "start_prototype",
    description: "Exploration mode: build several quick, genuinely different working prototypes of an idea (a new screen, flow or concept), each a real screen with the product's components and data, outside the navigation, with live links and screenshots. For exploring ideas, not for shipping fixes. Images attached in the thread are passed along. Takes about 3 minutes; results are posted to this thread. Only when the person asks for prototypes, directions or explorations, or agrees to them.",
    input_schema: { type: "object", additionalProperties: false, required: ["brief"],
      properties: {
        brief: { type: "string", description: "The idea to explore, including what was discussed" },
        variants: { type: "integer", description: "How many directions, 2 to 5 (default 3)" },
      } },
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
    case "learned": {
      const k = loadLearned();
      const q = String(input.query ?? "").toLowerCase();
      const screen = String(input.screen ?? "");
      const entries = k.entries.filter((e) => (!screen || e.screens.includes(screen)) &&
        (!q || JSON.stringify(e).toLowerCase().includes(q)));
      return JSON.stringify({ updated: k.updated, sources_read: k.processed.length,
        conflicts: k.conflicts.filter((c) => c.status === "open"), entries }, null, 1).slice(0, 30_000);
    }
    case "learn_now": {
      const r = await learn();
      return JSON.stringify({ new_sources: r.newSources, new_entries: r.newEntries, new_conflicts: r.newConflicts,
        open_conflicts: r.knowledge.conflicts.filter((c) => c.status === "open"),
        entries: r.knowledge.entries.map((e) => `${e.id} [${e.type}, ${e.strength}] ${e.title}`) });
    }
    case "status":
      return JSON.stringify(hooks.status());
    case "start_review":
      return hooks.startRun();
    case "start_request":
      return hooks.startRun(String(input.request ?? ""));
    case "sketch":
      return hooks.sketch(String(input.change ?? ""), String(input.route ?? "/alerts"));
    case "start_prototype":
      return hooks.startPrototype(String(input.brief ?? ""), Number(input.variants ?? 3));
    default:
      return `Unknown tool ${name}`;
  }
}
