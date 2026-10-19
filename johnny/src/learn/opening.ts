import fs from "node:fs";
import path from "node:path";
import { ROOT } from "../paths";
import { structured } from "../llm";
import { buildCodeGraph, reachable } from "../observe/codeGraph";
import { codeTools, runAgent } from "../target/codeTools";
import type { RouteInfo } from "../target/graph";
import type { Knowledge } from "./learn";

// Johnny's first message after reading a team's Slack history: what keeps coming back, what was decided
// but isn't in the product (checked in the code, not taken from chat), and where what people said
// contradicts the written decisions. Specific enough that the team recognises their own product.

interface Check { reflected: "yes" | "partly" | "no" | "unclear"; evidence: string; files: string[] }

function sentinelRoutes(): RouteInfo[] {
  const g = buildCodeGraph();
  const lines = (f: string) => fs.readFileSync(path.join(ROOT, f), "utf8").split("\n").length;
  return g.routes.map((r) => {
    const files = reachable(g, r.file);
    return { route: r.path, page: r.file, files, lines: files.reduce((n, f) => n + lines(f), 0) };
  });
}

// Is a decision people made actually in the product? He looks, rather than trusting the chat.
async function checkInProduct(decision: string, routes: RouteInfo[]): Promise<Check> {
  const code = codeTools(ROOT, routes);
  const { result } = await runAgent<Check>({
    system: `The team decided something about the product. Check in the code whether the product does it today.
Look at what users would see (components, screens, styles). Be concrete: "reflected" is yes only if you read
the code that does it. Evidence: one or two sentences in the user's terms, with file:line.`,
    intro: `Decision: ${decision}\n\nScreens: ${routes.map((r) => `${r.route} (${r.page})`).join(", ")}`,
    tools: [...code.defs, { name: "submit_check", description: "Submit the check. Call once.", strict: true, input_schema: {
      type: "object", additionalProperties: false, required: ["reflected", "evidence", "files"],
      properties: { reflected: { type: "string", enum: ["yes", "partly", "no", "unclear"] }, evidence: { type: "string" }, files: { type: "array", items: { type: "string" } } } } }],
    submit: "submit_check", run: code.run, maxSteps: 8, effort: "low",
  });
  return result;
}

export async function openingMessage(k: Knowledge, read: { channels: string[]; messages: number; weeks: number }) {
  const routes = sentinelRoutes();
  const decisions = k.entries.filter((e) => e.type === "decision" && e.evidence.some((v) => v.source.startsWith("slack:")));
  const checks = await Promise.all(decisions.slice(0, 5).map(async (d) => ({ id: d.id, title: d.title, ...(await checkInProduct(d.statement, routes)) })));

  const r = await structured<{ text: string }>(
    `Write your first message to a product team in Slack, right after you joined and read their channels.
You're their new product designer. The point of this message is that they recognise their own product in it
and see you understood things nobody had connected. Be specific, not generic.

Structure (Slack mrkdwn: *bold*, • bullets, no headings, no tables):
1. One line: what you read (channels, how far back).
2. *What keeps coming back*: the 2-3 strongest recurring pains, each with how often / which accounts / who
   raised it, one short exact quote, and the screen.
3. *Decided, but not in the product*: decisions from the chat that the code check says aren't (or are only
   partly) in the product, with when it was decided and what the user sees today. Only use the checks given.
4. *Needs a decision*: open conflicts between what was said and the written decision log, as a question
   to the person who can answer it. Don't take a side.
5. One line offering a concrete next step (e.g. a sketch for the top item), as a question.

Under 220 words. Write in the language most of the team's messages are in. Names as given.
Don't invent anything: use only the knowledge, conflicts and checks below.`,
    `Read: ${JSON.stringify(read)}\n\nKnowledge entries:\n${JSON.stringify(k.entries, null, 1)}\n\n` +
    `Open conflicts:\n${JSON.stringify(k.conflicts.filter((c) => c.status === "open"), null, 1)}\n\n` +
    `Decision checks in the code:\n${JSON.stringify(checks, null, 1)}`,
    { type: "object", additionalProperties: false, required: ["text"], properties: { text: { type: "string" } } },
    "medium",
  );
  return { text: r.text, checks };
}
