import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import type Anthropic from "@anthropic-ai/sdk";
import { CHARTER } from "../charter";
import { client, costUSD, MODEL, track, usage } from "../llm";
import { OUT } from "../paths";
import { DECISION_SCHEMA, type Decision } from "../decide/decide";
import { buildRouteGraph } from "./graph";
import { buildMonorepoGraph } from "./monorepo";
import { uiFirst, viewFiles } from "./context";

// Johnny on an external repo, investigating instead of reading a fixed budget. Usage:
//   tsx src/target/investigate.ts <repo-root> [--app <app dir>] [--steps <n>]
// He starts from the product map, forms suspicions, and pulls only the code each one needs
// (read a file or a line range, search, list a screen's files), then submits a decision.
// Every cited line must be one he actually read.
const root = path.resolve(process.argv[2]);
const arg = (name: string) => { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] : undefined; };
const MAX_STEPS = Number(arg("--steps") ?? 40);
const t0 = Date.now();
const lap = (s: string) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s] ${s}`);

const routes = arg("--app") ? buildMonorepoGraph(root, arg("--app")!) : buildRouteGraph(root);
lap(`observe: ${routes.length} routes`);
const readme = fs.existsSync(path.join(root, "README.md")) ? fs.readFileSync(path.join(root, "README.md"), "utf8").slice(0, 6000) : "";
const map = routes.map((r) => `${r.route}  page=${r.page}  files=${r.files.length}  views=[${viewFiles(r).map((f) => path.basename(f, ".tsx")).join(", ")}]`).join("\n");

// What he has read, per file, as [from, to] line ranges. Citations are checked against this.
const read = new Map<string, [number, number][]>();
let charsRead = 0;
const MAX_LINES = 400;

const safe = (p: string) => {
  const abs = path.resolve(root, String(p).replace(/^\/+/, ""));
  if (!abs.startsWith(root + path.sep) || abs.includes(`${path.sep}node_modules${path.sep}`)) throw new Error(`Not readable: ${p}`);
  return abs;
};

const TOOLS = [
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

function runTool(name: string, input: Record<string, unknown>): string {
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
        return execFileSync("rg", ["-n", "-i", "--max-count", "5", "--glob", "!**/node_modules/**", "--glob", "!**/*.generated.*",
          "--glob", "!**/locales/**", "--", String(input.pattern), dir], { cwd: root, encoding: "utf8", maxBuffer: 20e6 })
          .split("\n").filter(Boolean).slice(0, 50).map((l) => path.relative(root, l.startsWith("/") ? l : path.join(root, l)) || l)
          .map((l) => l.replace(/^(\.\.\/)+/, "")).join("\n") || "No matches";
      } catch { return "No matches"; }
    }
  }
  return `Unknown tool ${name}`;
}

const SYSTEM = `${CHARTER}

---

You are looking at an existing product's codebase for the first time. Nobody told you what to fix.
Find the UX problems that would hurt this product's core users most, rank them, and pick one to fix now.

The codebase is too large to read whole, so investigate like an engineer new to it:
1. From the README and the route map, work out what the product is and who uses it, and pick the screens
   core users touch most.
2. Use route_files to find each screen's view and components, then read them.
3. When something looks wrong, form a suspicion and check it: read the hook, component or handler it
   depends on, and search before claiming something is missing or never happens.
4. Drop suspicions the code doesn't support. Keep going until you have enough to decide, then call
   submit_decision. You have about ${MAX_STEPS} steps; you can call several tools in one step.

There is no usage data and no written product decisions. So:
- Evidence is code only. Cite "path:line" or "path:from-to" exactly as numbered in what you read; you may
  only cite lines you actually read. The README may be cited as "README.md".
- Impact is your judgement; say so in the reason and do not invent metrics, user quotes or research.
- Some things that look odd may be deliberate. If code suggests a choice was intentional, mark it
  do_not_change or later.
- Propose exactly two options, A and B, with different approaches to the root cause. List in
  files_to_change only files you read.
- Use the product's own components and patterns that appear in the code.`;

type Msg = Anthropic.Beta.BetaMessageParam;
const messages: Msg[] = [{ role: "user", content: `README:\n${readme}\n\nRoute map (${routes.length} routes):\n${map}` }];
let decision: Decision | undefined;
let steps = 0;

for (; steps < MAX_STEPS && !decision; steps++) {
  const last = steps === MAX_STEPS - 1;
  if (last) messages.push({ role: "user", content: "That's the last step: call submit_decision now with what you have." });
  const response = await client().beta.messages.stream({
    model: MODEL,
    max_tokens: 64000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    cache_control: { type: "ephemeral" },
    system: SYSTEM,
    output_config: { effort: "high" },
    tools: TOOLS as unknown as Anthropic.Beta.BetaTool[],
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
    if (u.name === "submit_decision") { decision = input as unknown as Decision; results.push({ type: "tool_result", tool_use_id: u.id, content: "Received." }); continue; }
    let out: string;
    try { out = runTool(u.name, input); } catch (e) { out = `Error: ${(e as Error).message}`; }
    console.log(`  step ${steps + 1}: ${u.name} ${JSON.stringify(input).slice(0, 110)}`);
    results.push({ type: "tool_result", tool_use_id: u.id, content: out });
  }
  messages.push({ role: "user", content: results });
}
if (!decision) throw new Error(`No decision after ${steps} steps`);
const filesRead = [...read.keys()];
lap(`decide: ${steps} steps, read ${filesRead.length} files (${(charsRead / 1000).toFixed(0)}k chars), ${decision.findings.length} findings, chose "${decision.chosen_finding}"`);

// A citation is valid only if every cited line is inside a range he read.
const checks = decision.findings.flatMap((f) => f.evidence.map((e) => {
  if (e.source === "README.md") return { ...e, ok: !!readme };
  const m = /^([^:]+?)(?::([\d,\s-]+))?$/.exec(e.source.trim());
  if (!m) return { ...e, ok: false };
  const ranges = read.get(m[1]);
  if (!ranges) return { ...e, ok: false };
  const lines = (m[2] ?? "").split(",").flatMap((part) => {
    const [a, b] = part.trim().split("-").map(Number);
    return Number.isFinite(a) ? [a, ...(Number.isFinite(b) ? [b] : [])] : [];
  });
  return { ...e, ok: lines.every((l) => ranges.some(([from, to]) => l >= from && l <= to)) };
}));
const bad = checks.filter((c) => !c.ok);
lap(`citations: ${checks.length - bad.length}/${checks.length} valid` + (bad.length ? `; invalid: ${bad.map((b) => b.source).join(", ")}` : ""));

fs.mkdirSync(OUT, { recursive: true });
const file = path.join(OUT, `investigate-${path.basename(root)}.json`);
fs.writeFileSync(file, JSON.stringify({ repo: root, seconds: (Date.now() - t0) / 1000, steps, usage: { ...usage, usd: costUSD() },
  files_read: Object.fromEntries(read), chars_read: charsRead, decision, citations: checks }, null, 2));
lap(`report: ${path.relative(path.dirname(OUT), file)}`);
console.log(`cost: ${usage.calls} calls, ${usage.input} in / ${usage.cacheRead} cache-read / ${usage.cacheWrite} cache-write / ${usage.output} out tokens, $${costUSD().toFixed(2)}`);
