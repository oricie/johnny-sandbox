import path from "node:path";
import { CHARTER } from "../charter";
import { DECISION_SCHEMA, type Decision } from "../decide/decide";
import type { RouteInfo } from "./graph";
import { viewFiles } from "./context";
import { codeTools, runAgent } from "./codeTools";

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

export const routeMap = (routes: RouteInfo[]) => routes.map((r) =>
  `${r.route}  page=${r.page}  files=${r.files.length}  views=[${viewFiles(r).map((f) => path.basename(f, ".tsx")).join(", ")}]`).join("\n");

export async function investigate(opts: InvestigateOptions): Promise<Investigation> {
  const { root, routes } = opts;
  const maxSteps = opts.maxSteps ?? 40;
  const code = codeTools(root, routes);
  const read = code.read;
  const submit = {
    name: "submit_decision",
    description: "Submit your findings, the one to fix now and two options. Call it once, when you're done.",
    input_schema: DECISION_SCHEMA,
    strict: true,
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

  const { result: decision, steps } = await runAgent<Decision>({
    system, maxSteps, onStep: opts.onStep, submit: "submit_decision", run: code.run,
    tools: [...code.defs, submit],
    intro: `${opts.intro}\n\nRoute map (${routes.length} routes):\n${routeMap(routes)}`,
  });
  const charsRead = code.chars();

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
