import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import type Anthropic from "@anthropic-ai/sdk";
import { client, MODEL, track } from "../llm";
import type { RouteInfo } from "./graph";
import { uiFirst } from "./context";

// The tools Johnny uses to find his way around a codebase he doesn't know, and the loop that runs them.
// Everything he reads is recorded as line ranges, so citations can be checked against what he saw.

const MAX_LINES = 400;
const RG_EXCLUDES = ["!**/node_modules/**", "!**/*.generated.*", "!**/locales/**", "!**/dist/**", "!out/**", "!.worktrees/**"];

// Translation files map what users read to the keys the code uses, so they're the bridge from
// "the user sees 'Use a different email'" to the component that renders it.
function localeFiles(root: string): string[] {
  try {
    return execFileSync("rg", ["--files", "-g", "**/locales/en/*.json", "-g", "**/locales/en.json", "-g", "**/messages/en.json", "-g", "**/i18n/en.json", "-g", "!**/node_modules/**"],
      { cwd: root, encoding: "utf8" }).split("\n").filter(Boolean);
  } catch { return []; }
}

export function codeTools(root: string, routes: RouteInfo[]) {
  const read = new Map<string, [number, number][]>();
  let chars = 0;
  const locales = localeFiles(root);
  const strings: [string, string][] = locales.flatMap((f) => {
    try {
      const flat: [string, string][] = [];
      const walk = (o: unknown, prefix: string) => {
        if (typeof o === "string") flat.push([prefix, o]);
        else if (o && typeof o === "object") for (const [k, v] of Object.entries(o)) walk(v, prefix ? `${prefix}.${k}` : k);
      };
      walk(JSON.parse(fs.readFileSync(path.join(root, f), "utf8")), "");
      return flat;
    } catch { return []; }
  });

  const safe = (p: string) => {
    const abs = path.resolve(root, String(p).replace(/^\/+/, ""));
    if (!abs.startsWith(root + path.sep) || abs.includes(`${path.sep}node_modules${path.sep}`)) throw new Error(`Not readable: ${p}`);
    return abs;
  };
  const rg = (args: string[]) => {
    try {
      return execFileSync("rg", args, { cwd: root, encoding: "utf8", maxBuffer: 20e6 }).split("\n").filter(Boolean)
        .map((l) => (l.startsWith("/") ? path.relative(root, l) : l));
    } catch { return []; }
  };
  const seen = (hits: string[]) => {
    for (const h of hits) {
      const m = /^(.+?):(\d+):/.exec(h);
      if (m) read.set(m[1], [...(read.get(m[1]) ?? []), [Number(m[2]), Number(m[2])]]);
    }
    return hits;
  };

  const defs = [
    {
      name: "route_files",
      description: "List the files a screen renders or depends on, rendered UI first and server code last, with line counts. Use it to find a screen's view, components and hooks before reading.",
      input_schema: { type: "object", additionalProperties: false, required: ["route"],
        properties: { route: { type: "string" }, limit: { type: "integer", description: "Default 60" } } },
    },
    {
      name: "read_file",
      description: `Read a file with line numbers, or a range of it (at most ${MAX_LINES} lines per call). Read only what you need.`,
      input_schema: { type: "object", additionalProperties: false, required: ["path"],
        properties: { path: { type: "string", description: "Repo-relative" }, from: { type: "integer" }, to: { type: "integer" } } },
    },
    {
      name: "search",
      description: "Search the code (ripgrep regex, case-insensitive) and get file:line matches. Use it to find where something is defined or used, and before claiming something does not exist.",
      input_schema: { type: "object", additionalProperties: false, required: ["pattern"],
        properties: { pattern: { type: "string" }, path: { type: "string", description: "Optional repo-relative directory to search in" } } },
    },
    ...(strings.length ? [{
      name: "find_ui_text",
      description: "Find interface text the way users see it (a label, button, heading, message) in the product's translation files, and the code that renders it. Returns matching translation keys with their English text, and where each key is used. The fastest way from what a user describes to the component.",
      input_schema: { type: "object", additionalProperties: false, required: ["text"],
        properties: { text: { type: "string", description: "Words as shown on screen, e.g. 'Use a different email'" } } },
    }] : []),
  ];

  const run = (name: string, input: Record<string, unknown>): string | undefined => {
    switch (name) {
      case "route_files": {
        const r = routes.find((x) => x.route === input.route);
        if (!r) return `No such route. Routes: ${routes.map((x) => x.route).join(", ")}`;
        const files = [r.page, ...uiFirst(r.files.filter((f) => f !== r.page))].slice(0, Number(input.limit ?? 60));
        return `${r.files.length} files in total.\n` + files.map((f) => `${f} (${fs.readFileSync(path.join(root, f), "utf8").split("\n").length} lines)`).join("\n");
      }
      case "read_file": {
        const abs = safe(String(input.path));
        if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) return `No such file: ${input.path}`;
        const lines = fs.readFileSync(abs, "utf8").split("\n");
        const from = Math.max(1, Number(input.from ?? 1));
        const to = Math.min(lines.length, Number(input.to ?? from + MAX_LINES - 1), from + MAX_LINES - 1);
        const rel = path.relative(root, abs).split(path.sep).join("/");
        read.set(rel, [...(read.get(rel) ?? []), [from, to]]);
        const out = lines.slice(from - 1, to).map((l, i) => `${from + i}| ${l}`).join("\n");
        chars += out.length;
        return `${rel} (${lines.length} lines; showing ${from}-${to})\n${out}`;
      }
      case "search": {
        const dir = input.path ? safe(String(input.path)) : root;
        const hits = rg(["-n", "-i", "--max-count", "5", ...RG_EXCLUDES.flatMap((g) => ["--glob", g]), "--", String(input.pattern), dir]).slice(0, 50);
        return seen(hits).join("\n") || "No matches";
      }
      case "find_ui_text": {
        const words = String(input.text).toLowerCase().split(/\W+/).filter((w) => w.length > 2);
        const scored = strings.map(([key, text]) => {
          const t = text.toLowerCase();
          const exact = t.includes(String(input.text).toLowerCase()) ? 10 : 0;
          return { key, text, score: exact + words.filter((w) => t.includes(w)).length / Math.max(1, words.length) };
        }).filter((s) => s.score >= 0.6).sort((a, b) => b.score - a.score || a.text.length - b.text.length).slice(0, 8);
        if (!scored.length) return "No matching interface text. Try other words, or search the code.";
        return scored.map(({ key, text }) => {
          const uses = rg(["-n", "--max-count", "3", ...RG_EXCLUDES.flatMap((g) => ["--glob", g]), "-g", "*.{ts,tsx,js,jsx}", "-F", `"${key}"`, "."]).slice(0, 6);
          return `"${text}"  key=${key}\n` + (seen(uses).map((u) => `  ${u.slice(0, 160)}`).join("\n") || "  (key not found in code; may be built dynamically)");
        }).join("\n");
      }
    }
    return undefined;
  };

  return { defs, run, read, chars: () => chars };
}

export interface AgentLoop<T> {
  system: string;
  intro: Anthropic.Beta.BetaMessageParam["content"];
  tools: { name: string; [k: string]: unknown }[];
  submit: string; // the tool whose input is the result
  run: (name: string, input: Record<string, unknown>) => string | undefined;
  maxSteps: number;
  effort?: "low" | "medium" | "high";
  onStep?: (line: string) => void;
}

// Tool-use loop until he calls the submit tool; the last step asks him to submit with what he has.
export async function runAgent<T>(a: AgentLoop<T>): Promise<{ result: T; steps: number }> {
  const messages: Anthropic.Beta.BetaMessageParam[] = [{ role: "user", content: a.intro }];
  let result: T | undefined;
  let steps = 0;
  for (; steps < a.maxSteps && result === undefined; steps++) {
    if (steps === a.maxSteps - 1) messages.push({ role: "user", content: `That's the last step: call ${a.submit} now with what you have.` });
    const response = await client().beta.messages.stream({
      model: MODEL, max_tokens: 64000,
      betas: ["server-side-fallback-2026-07-01"], fallbacks: "default",
      cache_control: { type: "ephemeral" },
      system: a.system, output_config: { effort: a.effort ?? "high" },
      tools: a.tools as unknown as Anthropic.Beta.BetaTool[], messages,
    }).finalMessage();
    track(response);
    if (response.stop_reason === "refusal") throw new Error("Model declined the request");
    messages.push({ role: "assistant", content: response.content });
    const uses = response.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use");
    if (!uses.length) {
      messages.push({ role: "user", content: `Keep going with the tools, or call ${a.submit}.` });
      continue;
    }
    const results: Anthropic.Beta.BetaToolResultBlockParam[] = [];
    for (const u of uses) {
      const input = u.input as Record<string, unknown>;
      if (u.name === a.submit) {
        result = input as T;
        results.push({ type: "tool_result", tool_use_id: u.id, content: "Received." });
        continue;
      }
      let out: string;
      try { out = a.run(u.name, input) ?? `Unknown tool ${u.name}`; } catch (e) { out = `Error: ${(e as Error).message}`; }
      a.onStep?.(`step ${steps + 1}: ${u.name} ${JSON.stringify(input).slice(0, 110)}`);
      results.push({ type: "tool_result", tool_use_id: u.id, content: out });
    }
    messages.push({ role: "user", content: results });
  }
  if (result === undefined) throw new Error(`Nothing submitted after ${steps} steps`);
  return { result, steps };
}
