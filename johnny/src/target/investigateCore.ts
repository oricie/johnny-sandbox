import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import type Anthropic from "@anthropic-ai/sdk";
import { CHARTER } from "../charter";
import { client, MODEL, track } from "../llm";
import { DECISION_SCHEMA, type Decision } from "../decide/decide";
import type { RouteInfo } from "./graph";
import { uiFirst, viewFiles } from "./context";

// Johnny investigating a codebase instead of reading a fixed budget of it. He starts from the
// product map, forms suspicions, and pulls only the code each one needs (list a screen's files,
// read a file or range, search), then submits a decision. Every cited line must be one he read.

export interface InvestigateOptions {
  root: string;
  routes: RouteInfo[];
  intro: string; // what he's told up front: README, product docs, signals, decisions...
  rules: string; // what counts as evidence and what he may change
  maxSteps?: number;
  // Sources that aren't code lines (knowledge ids, analytics paths): true if valid.
  validNonFile?: (source: string) => boolean | undefined;
  onStep?: (line: string) => void;
}

export interface Investigation {
  decision: Decision;
  steps: number;
  filesRead: Record<string, [number, number][]>;
  charsRead: number;
  citations: { source: string; claim: string; ok: boolean }[];
}

const MAX_LINES = 400;

export const routeMap = (routes: RouteInfo[]) => routes.map((r) =>
  `${r.route}  page=${r.page}  files=${r.files.length}  views=[${viewFiles(r).map((f) => path.basename(f, ".tsx")).join(", ")}]`).join("\n");

export async function investigate(opts: InvestigateOptions): Promise<Investigation> {
  const { root, routes } = opts;
  const maxSteps = opts.maxSteps ?? 40;
  const read = new Map<string, [number, number][]>();
  let charsRead = 0;

  const safe = (p: string) => {
    const abs = path.resolve(root, String(p).replace(/^\/+/, ""));
    if (!abs.startsWith(root + path.sep) || abs.includes(`${path.sep}node_modules${path.sep}`)) throw new Error(`Not readable: ${p}`);
    return abs;
  };

  const tools = [
    {
      name: "route_files",
      description: "List the files a screen renders or depends on, rendered UI first and server code last, with line counts. Use it to find a screen's view, components and hooks before reading.",
      input_schema: { type: "object", additionalProperties: false, required: ["route"],
        properties: { route: { type: "string" }, limit: { type: "integer", description: "Default 60" } } },
    },
    {
      name: "read_file",
      description: `Read a file with line numbers, or a range of it (at most ${MAX_LINES} lines per call). Read only what you need to check a suspicion.`,
      input_schema: { type: "object", additionalProperties: false, required: ["path"],
        properties: { path: { type: "string", description: "Repo-relative" }, from: { type: "integer" }, to: { type: "integer" } } },
    },
    {
      name: "search",
      description: "Search the repo (ripgrep regex, case-insensitive) and get file:line matches. Use it to find where something is defined or used, and before claiming something does not exist.",
      input_schema: { type: "object", additionalProperties: false, required: ["pattern"],
        properties: { pattern: { type: "string" }, path: { type: "string", description: "Optional repo-relative directory to search in" } } },
    },
    {
      name: "submit_decision",
      description: "Submit your findings, the one to fix now and two options. Call it once, when you're done.",
      input_schema: DECISION_SCHEMA,
      strict: true,
    },
  ];

  const runTool = (name: string, input: Record<string, unknown>): string => {
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
        charsRead += out.length;
        return `${rel} (${lines.length} lines; showing ${from}-${to})\n${out}`;
      }
      case "search": {
        const dir = input.path ? safe(String(input.path)) : root;
        try {
          const hits = execFileSync("rg", ["-n", "-i", "--max-count", "5", "--glob", "!**/node_modules/**", "--glob", "!**/*.generated.*",
            "--glob", "!**/locales/**", "--glob", "!**/dist/**", "--glob", "!out/**", "--glob", "!.worktrees/**",
            "--", String(input.pattern), dir], { cwd: root, encoding: "utf8", maxBuffer: 20e6 })
            .split("\n").filter(Boolean).slice(0, 50).map((l) => (l.startsWith("/") ? path.relative(root, l) : l));
          // A matching line he was shown counts as read, so he can cite it.
          for (const h of hits) {
            const m = /^(.+?):(\d+):/.exec(h);
            if (m) read.set(m[1], [...(read.get(m[1]) ?? []), [Number(m[2]), Number(m[2])]]);
          }
          return hits.join("\n") || "No matches";
        } catch { return "No matches"; }
      }
    }
    return `Unknown tool ${name}`;
  };

  const system = `${CHARTER}

---

You are reviewing a product as its designer, through its codebase. Nobody told you what to fix. Find the
user experience problems that would hurt this product's core users most, rank them, and pick one to fix now.
Judge what users see and do: flows, hierarchy, clarity, copy, feedback, empty, loading and error states,
consistency. Title and describe each finding from the user's side. A purely technical bug with no visible
effect on users gets at most one finding titled "For engineering: ..." with action later.

Investigate like an engineer new to the code, not by reading everything:
1. From what you're given up front, work out who the core users are and which screens matter most.
2. Use route_files to find each screen's view and components, then read them.
3. When something looks wrong, form a suspicion and check it: read the hook, component or handler it
   depends on, and search before claiming something is missing or never happens.
4. Drop suspicions the code doesn't support. Keep going until you have enough to decide, then call
   submit_decision. You have about ${maxSteps} steps; you can call several tools in one step.

Evidence:
- Cite code as "path:line" or "path:from-to" exactly as numbered in what you read; you may only cite
  lines you actually read.
- Some things that look odd may be deliberate. If code or a decision suggests a choice was intentional,
  mark it do_not_change or later.
- Propose exactly two design directions, A and B, with different approaches to the user's problem. List in
  files_to_change only files you read.
- Use the product's own components and patterns that appear in the code.
${opts.rules}`;

  type Msg = Anthropic.Beta.BetaMessageParam;
  const messages: Msg[] = [{ role: "user", content: `${opts.intro}\n\nRoute map (${routes.length} routes):\n${routeMap(routes)}` }];
  let decision: Decision | undefined;
  let steps = 0;

  for (; steps < maxSteps && !decision; steps++) {
    if (steps === maxSteps - 1) messages.push({ role: "user", content: "That's the last step: call submit_decision now with what you have." });
    const response = await client().beta.messages.stream({
      model: MODEL,
      max_tokens: 64000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      cache_control: { type: "ephemeral" },
      system,
      output_config: { effort: "high" },
      tools: tools as unknown as Anthropic.Beta.BetaTool[],
      messages,
    }).finalMessage();
    track(response);
    if (response.stop_reason === "refusal") throw new Error("Model declined the request");
    messages.push({ role: "assistant", content: response.content });
    const uses = response.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use");
    if (!uses.length) {
      messages.push({ role: "user", content: "Keep investigating with the tools, or call submit_decision." });
      continue;
    }
    const results: Anthropic.Beta.BetaToolResultBlockParam[] = [];
    for (const u of uses) {
      const input = u.input as Record<string, unknown>;
      if (u.name === "submit_decision") {
        decision = input as unknown as Decision;
        results.push({ type: "tool_result", tool_use_id: u.id, content: "Received." });
        continue;
      }
      let out: string;
      try { out = runTool(u.name, input); } catch (e) { out = `Error: ${(e as Error).message}`; }
      opts.onStep?.(`step ${steps + 1}: ${u.name} ${JSON.stringify(input).slice(0, 110)}`);
      results.push({ type: "tool_result", tool_use_id: u.id, content: out });
    }
    messages.push({ role: "user", content: results });
  }
  if (!decision) throw new Error(`No decision after ${steps} steps`);

  // A code citation is valid only if every cited line is inside a range he read.
  const citations = decision.findings.flatMap((f) => f.evidence.map((e) => {
    const other = opts.validNonFile?.(e.source.trim());
    if (other !== undefined) return { ...e, ok: other };
    const m = /^([^:]+?)(?::([\d,\s-]+))?$/.exec(e.source.trim());
    const ranges = m && read.get(m[1]);
    if (!m || !ranges) return { ...e, ok: false };
    const lines = (m[2] ?? "").split(",").flatMap((part) => {
      const [a, b] = part.trim().split("-").map(Number);
      return Number.isFinite(a) ? [a, ...(Number.isFinite(b) ? [b] : [])] : [];
    });
    return { ...e, ok: lines.every((l) => ranges.some(([from, to]) => l >= from && l <= to)) };
  }));

  return { decision, steps, filesRead: Object.fromEntries(read), charsRead, citations };
}
