import fs from "node:fs";
import path from "node:path";
import { ROOT, OUT } from "../paths";
import { costUSD, usage } from "../llm";
import { reply, type Turn } from "../agent/agent";
import { sketch } from "../sketch";
import { runJohnny, type RunResult } from "../pipeline";
import { importExport } from "../learn/slackHistory";
import { learn } from "../learn/learn";
import { openingMessage } from "../learn/opening";

// The end-to-end demo without Slack in between: the same agent, tools and pipeline the bot uses, driven
// by the lines the presenter will type. Writes a transcript with the sketch and screenshots, so every
// step is known to work before anyone watches. Usage: tsx src/demo/rehearse.ts
const dir = path.join(OUT, "demo");
fs.rmSync(dir, { recursive: true, force: true });
fs.mkdirSync(dir, { recursive: true });
const t0 = Date.now();
const lap = (s: string) => console.log(`[${((Date.now() - t0) / 1000).toFixed(0)}s] ${s}`);
const md: string[] = ["# Demo rehearsal", ""];
const keep = (file: string) => { const to = path.join(dir, path.basename(file)); fs.copyFileSync(file, to); return path.basename(to); };

// 1. Added to the channel: read the history, learn, post the opening message.
const read = importExport(path.join(ROOT, "fixtures/slack-export"));
const l = await learn();
const opening = await openingMessage(l.knowledge, { channels: read.map((r) => `#${r.channel}`),
  messages: read.reduce((n, r) => n + r.messages, 0), weeks: Math.max(...read.map((r) => r.weeks)) });
lap(`opening message (learned ${l.newSources} new sources)`);
md.push("## Johnny joins the channel", "", opening.text, "");

// 2. The conversation in the opening message's thread.
const lines = [
  "כן, תשרטט את התור",
  "ומה אם נצבע את החומרה ככה גם במסך האירוע? זה לא נוגע ב-D-12?",
  "שאלה על הדיזיין סיסטם: אם נוסיף טוקן לרקע של שורה קריטית, איך תוודא שהניגודיות עוברת AA?",
  "מעולה. תבנה את זה, שתי אופציות",
];
const history: Turn[] = [{ role: "assistant", text: opening.text }];
let pending: Promise<RunResult> | undefined;
let lastSketch: string | undefined;
for (const line of lines) {
  history.push({ role: "user", text: line, name: "Maya" });
  md.push(`**Maya:** ${line}`, "");
  const answer = await reply(history, {
    status: () => ({ busy: !!pending }),
    catchUp: async () => "Already read this channel.",
    startPrototype: async () => "Prototypes aren't part of this rehearsal.",
    sketch: async (change, route) => {
      const s = await sketch(change, route);
      lastSketch = s.file;
      md.push(`![sketch](${keep(s.file)})`, `_Sketch: ${s.notes}_`, "");
      lap(`sketch: ${s.notes.slice(0, 80)}`);
      return `Sketch posted in the thread. What you changed: ${s.notes}. Ask whether to build it.`;
    },
    startRun: async (request) => {
      lap(`build started: ${(request ?? "review").slice(0, 80)}`);
      pending = runJohnny({ request, act: true, images: lastSketch ? [lastSketch] : [] });
      return "Started. Progress and results will be posted in this thread in 2-3 minutes.";
    },
  });
  history.push({ role: "assistant", text: answer });
  md.push(`**Johnny:** ${answer}`, "");
  lap(`reply to "${line.slice(0, 30)}…" (${answer.length} chars)`);
}

// 3. The build's result, as the bot would post it.
if (pending) {
  const r = await pending;
  lap(`build done: ${r.results.map((x) => `${x.option} ${x.ok ? "ok" : "failed"}`).join(", ")}`);
  md.push("## Build result", "", `**Finding:** ${r.decision.chosen_finding}`, "");
  if (r.decision.request) md.push(`**Verdict:** ${r.decision.request.verdict}: ${r.decision.request.explanation}`, "");
  if (r.beforePreview) md.push(`Today: ${r.beforePreview}`, "");
  for (const x of r.results) md.push(`- **${x.option}** ${x.ok ? "✅" : "❌"} ${x.summary ?? ""} ${x.preview ? `· live: ${x.preview}` : ""} · \`${x.branch}\`` +
    (x.selfcheck ? (x.selfcheck.ok ? "\n  - 🔎 screenshot matches what I wrote" : `\n  - ⚠️ screenshot doesn't match: ${x.selfcheck.issues.join(" ")}`) : ""));
  md.push("");
  for (const f of [r.beforeShot, ...r.results.map((x) => x.shot)]) if (f && fs.existsSync(f)) md.push(`![${path.basename(f)}](${keep(f)})`);
}
md.push("", `_Total ${((Date.now() - t0) / 60000).toFixed(1)} min, model cost $${costUSD().toFixed(2)} (${usage.calls} calls)._`);
fs.writeFileSync(path.join(dir, "rehearsal.md"), md.join("\n"));
lap(`transcript: out/demo/rehearsal.md · $${costUSD().toFixed(2)}`);
