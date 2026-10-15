import fs from "node:fs";
import path from "node:path";
import { ROOT } from "../paths";
import { structured, imageBlocks } from "../llm";
import { checkPlan } from "../guard/constraints";
import type { Decision } from "../decide/decide";
import { createWorktree, commitAll } from "./worktree";
import { runChecks } from "./checks";

type Option = Decision["options"][number];

interface Edit { summary: string; files: { path: string; content: string }[] }

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["summary", "files"],
  properties: {
    summary: { type: "string" },
    files: {
      type: "array",
      items: {
        type: "object", additionalProperties: false, required: ["path", "content"],
        properties: { path: { type: "string" }, content: { type: "string" } },
      },
    },
  },
} as const;

const SYSTEM = `You are Johnny, a product design agent. You already chose a design option for an
existing React product; now implement it in code.

Rules:
- Return the complete new content of every file you change. Do not return unchanged files.
- Only change files under demo-app/src/components, demo-app/src/screens or demo-app/src/styles.
  demo-app/src/api/** is read-only: work with the types as they are.
- Follow the design system: tokens from tokens.css (add new tokens there if needed, never hex in
  components), Table for lists, Badge for labels, severity word always visible.
- Respect every product decision you are given. Keep all other screens and flows working.
- Write code that matches the surrounding code's style. TypeScript strict mode must pass.`;

function fileBlock(rel: string, dir: string) {
  return `--- ${rel}\n${fs.readFileSync(path.join(dir, rel), "utf8")}`;
}

function appFiles(dir: string) {
  const base = path.join(dir, "demo-app/src");
  return (fs.readdirSync(base, { recursive: true }) as string[])
    .filter((f) => /\.(tsx?|css)$/.test(f))
    .map((f) => `demo-app/src/${f.split(path.sep).join("/")}`);
}

function applyEdit(edit: Edit, dir: string) {
  const plan = checkPlan(edit.files.map((f) => f.path));
  if (!plan.ok) throw new Error(`Edit touches files outside the allowed paths: ${plan.violations.join(", ")}`);
  for (const f of edit.files) fs.writeFileSync(path.join(dir, f.path), f.content);
}

export async function implementOption(decision: Decision, option: Option, images: string[] = []) {
  const { branch, dir } = createWorktree(option.id);
  const context = ["context/design-system.md", "context/decisions.md", "context/personas.md"]
    .map((f) => fileBlock(f, ROOT)).join("\n\n");
  const prompt = (extra = "") =>
    `Chosen finding: ${decision.chosen_finding}\n\nOption ${option.id}: ${option.name}\n${option.approach}\n` +
    `Planned files: ${option.files_to_change.join(", ")}\n\n${context}\n\nCurrent source:\n` +
    appFiles(dir).map((f) => fileBlock(f, dir)).join("\n\n") + extra;

  const withImages = (text: string) => images.length
    ? [...imageBlocks(images), { type: "text" as const, text: `The images above are part of the brief (references, not pixel targets).\n\n${text}` }]
    : text;
  let edit = await structured<Edit>(SYSTEM, withImages(prompt()), SCHEMA);
  applyEdit(edit, dir);
  let checks = runChecks(dir);

  // One repair round: show the failure and the files as they now are.
  if (!checks.ok) {
    edit = await structured<Edit>(SYSTEM, withImages(prompt(`\n\nYour previous edit failed the checks. Fix it.\n${checks.output}`)), SCHEMA);
    applyEdit(edit, dir);
    checks = runChecks(dir);
  }
  if (!checks.ok) return { option: option.id, branch, dir, ok: false as const, summary: edit.summary, checks: checks.output };

  const files = edit.files.map((f) => f.path);
  // Allowed by constraints but not in the option's own plan: reported, not blocked.
  const deviations = files.filter((f) => !option.files_to_change.includes(f));
  const sha = commitAll(dir, `Johnny: option ${option.id}, ${option.name}\n\n${edit.summary}`);
  return { option: option.id, branch, dir, ok: true as const, sha, summary: edit.summary, checks: checks.output,
    files, deviations };
}
