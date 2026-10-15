import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { App, Assistant, type SayFn } from "@slack/bolt";
import type { WebClient } from "@slack/web-api";
import { OUT, ROOT } from "../paths";
import { runJohnny, type RunResult } from "../pipeline";
import { reply, type Turn } from "../agent/agent";
import { buildSlackMessage } from "../report/slack";
import { checkCitations } from "../guard/citations";
import { loadKnowledge } from "../observe/knowledge";

// Johnny in Slack, over Socket Mode (no public URL needed).
//   /johnny review            -> proactive review of the product
//   /johnny <request>         -> request mode
//   @Johnny <request>         -> request mode, answered in the thread
//   @Johnny why ...? / למה...? -> answers from what he knows
//   Agent pane (DM)           -> same, in Slack's assistant threads
// Messages in channels he's invited to are kept in out/slack-inbox.jsonl for later learning.
const botToken = process.env.JOHNNY_SLACK_BOT_TOKEN;
const appToken = process.env.JOHNNY_SLACK_APP_TOKEN;
if (!botToken || !appToken) throw new Error("Set JOHNNY_SLACK_BOT_TOKEN and JOHNNY_SLACK_APP_TOKEN");

const app = new App({ token: botToken, appToken, socketMode: true });
let busy = false; // one run at a time: both options share the same worktrees
const runs = new Map<string, RunResult>(); // thread ts -> last run, for the approve buttons
const threads = new Set<string>(); // threads Johnny is part of: he answers there without a mention
let botUserId = "";

async function run(client: WebClient, channel: string, thread: string, request?: string) {
  if (busy) {
    await client.chat.postMessage({ channel, thread_ts: thread, text: "I'm in the middle of another run. Try again in a couple of minutes." });
    return;
  }
  busy = true;
  const status = await client.chat.postMessage({ channel, thread_ts: thread, text: "👀 Reading the product, the context and the usage data…" });
  const update = (text: string) => client.chat.update({ channel, ts: status.ts!, text });
  try {
    const result = await runJohnny({
      request, act: true,
      onProgress: async (stage, detail) => {
        if (stage === "decided") await update("🧠 Decided. Building both options in separate branches and checking them…");
        if (stage === "acted") await update(`🛠️ Built (${detail}). Taking screenshots…`);
      },
    });
    runs.set(thread, result);
    const { decision, results, beforeShot, beforePreview } = result;
    const citations = checkCitations(decision, loadKnowledge());

    const verdict = decision.request
      ? [{ type: "section", text: { type: "mrkdwn", text: `${decision.request.verdict === "push_back" ? "✋" : "👍"} ${decision.request.explanation}` } }]
      : [];
    const outcome = results.map((r) => `*${r.option}:* ${r.ok ? `✅ ${r.checks}${r.preview ? ` · <${r.preview}|▶ open live>` : ""} · \`${r.branch}\` @ \`${r.sha}\`` : "❌ checks failed"}` +
      (r.deviations?.length ? ` · ⚠️ outside the plan: ${r.deviations.map((f) => `\`${path.basename(f)}\``).join(", ")}` : ""));
    await update("Done.");
    await client.chat.postMessage({
      channel, thread_ts: thread, text: decision.chosen_finding,
      blocks: [...verdict, ...buildSlackMessage(decision, { citations }).slice(0, -1),
        { type: "context", elements: [{ type: "mrkdwn", text: (beforePreview ? `*Today:* <${beforePreview}|▶ open live>\n` : "") + (outcome.join("\n") || "Not built") }] },
        buildSlackMessage(decision, { citations }).at(-1)!] as never,
    });
    const files = [beforeShot, ...results.map((r) => r.shot)].filter((f): f is string => !!f && fs.existsSync(f));
    if (files.length) {
      await client.files.uploadV2({
        channel_id: channel, thread_ts: thread, initial_comment: "Before, then each option (actual builds, same data):",
        file_uploads: files.map((f) => ({ file: f, filename: path.basename(f) })),
      });
    }
  } catch (e) {
    await update(`Something went wrong: ${(e as Error).message.slice(0, 500)}`);
  } finally {
    busy = false;
  }
}

// The thread so far, as a conversation. Johnny's own messages are the assistant side.
async function threadHistory(client: WebClient, channel: string, thread: string, latest: string): Promise<Turn[]> {
  try {
    const r = await client.conversations.replies({ channel, ts: thread, limit: 50 });
    const turns = (r.messages ?? []).filter((m) => m.text).map((m): Turn => ({
      role: m.bot_id || m.user === botUserId ? "assistant" : "user",
      text: (m.text ?? "").replace(/<@[^>]+>/g, "").trim(),
      name: m.user,
    }));
    if (turns.length && turns.at(-1)!.role === "user") return turns;
  } catch { /* fall through: no history access, answer the message alone */ }
  return [{ role: "user", text: latest }];
}

// Every message is a turn in a conversation with Johnny. He decides whether to answer,
// look things up, or start a review or a build (through his tools).
async function handle(text: string, client: WebClient, channel: string, thread: string, say: SayFn) {
  threads.add(thread);
  const history = await threadHistory(client, channel, thread, text.trim());
  const answer = await reply(history, {
    status: () => ({ busy, runs: runs.size, lastFinding: [...runs.values()].at(-1)?.decision.chosen_finding }),
    startRun: async (request) => {
      if (busy) return "Busy: another run is in progress. Tell the person to try again in a couple of minutes.";
      void run(client, channel, thread, request);
      return "Started. Progress and results will be posted in this thread in 2-3 minutes.";
    },
  });
  if (answer) await say({ thread_ts: thread, text: answer });
}

app.command("/johnny", async ({ ack, command, client }) => {
  await ack();
  const root = await client.chat.postMessage({
    channel: command.channel_id,
    text: `<@${command.user_id}>: /johnny ${command.text || "review"}`,
  });
  const say: SayFn = (msg) => client.chat.postMessage({ channel: command.channel_id, ...(typeof msg === "string" ? { text: msg } : msg) } as never) as never;
  await handle(command.text, client, command.channel_id, root.ts!, say);
});

app.event("app_mention", async ({ event, client, say }) => {
  const text = event.text.replace(/<@[^>]+>/g, "");
  await client.reactions.add({ channel: event.channel, timestamp: event.ts, name: "eyes" }).catch(() => {});
  await handle(text, client, event.channel, event.thread_ts ?? event.ts, say);
});

app.action(/^(approve_a|approve_b|revise)$/, async ({ ack, action, body, client }) => {
  await ack();
  const b = body as { channel?: { id: string }; message?: { ts: string; thread_ts?: string }; user: { id: string } };
  const channel = b.channel!.id;
  const thread = b.message?.thread_ts ?? b.message!.ts;
  const id = (action as { action_id: string }).action_id;
  if (id === "revise") {
    await client.chat.postMessage({ channel, thread_ts: thread, text: "What should I change? Mention me in this thread with the change." });
    return;
  }
  const option = id.endsWith("a") ? "A" : "B";
  const r = runs.get(thread)?.results.find((x) => x.option === option);
  if (!r?.ok) {
    await client.chat.postMessage({ channel, thread_ts: thread, text: `Option ${option} isn't available to approve.` });
    return;
  }
  try {
    execFileSync("git", ["push", "-f", "-q", "origin", r.branch], { cwd: ROOT });
    const repo = execFileSync("git", ["remote", "get-url", "origin"], { cwd: ROOT }).toString().trim().replace(/\.git$/, "");
    await client.chat.postMessage({ channel, thread_ts: thread,
      text: `✅ <@${b.user.id}> approved option ${option}. Pushed \`${r.branch}\` (${r.sha}): ${repo}/compare/main...${r.branch}` });
  } catch (e) {
    await client.chat.postMessage({ channel, thread_ts: thread, text: `Approved, but pushing the branch failed: ${(e as Error).message.slice(0, 300)}` });
  }
});

// Agent: Slack's assistant pane. Each conversation is its own thread.
app.assistant(new Assistant({
  threadStarted: async ({ say, setSuggestedPrompts }) => {
    await say("Hi, I'm Johnny. I know Sentinel's code, decisions and usage data. Ask me something, give me a change, or say *review*.");
    await setSuggestedPrompts({ prompts: [
      { title: "Review the product", message: "review" },
      { title: "Why is containment locked?", message: "Why can only an incident lead isolate a host?" },
      { title: "Request a change", message: "Add a way to filter the alert queue by source" },
    ] });
  },
  userMessage: async ({ message, client, say, setStatus, setTitle }) => {
    const m = message as { text?: string; channel: string; thread_ts?: string; ts: string };
    if (!m.text) return;
    await setTitle(m.text.slice(0, 60));
    await setStatus("is thinking…");
    await handle(m.text, client, m.channel, m.thread_ts ?? m.ts, say);
  },
}));

// Listening: keep what people say in channels Johnny was invited to, for the learning step.
app.message(async ({ message, client, say }) => {
  const m = message as { subtype?: string; bot_id?: string; text?: string; user?: string; channel: string; ts: string; thread_ts?: string; channel_type?: string };
  if (m.subtype || m.bot_id || !m.text) return;
  // A reply in a thread Johnny is part of, without a mention (mentions go through app_mention).
  const mentioned = botUserId && m.text.includes(`<@${botUserId}>`);
  if (m.thread_ts && threads.has(m.thread_ts) && !mentioned && m.channel_type !== "im") {
    await handle(m.text, client, m.channel, m.thread_ts, say);
  }
  fs.mkdirSync(OUT, { recursive: true });
  fs.appendFileSync(path.join(OUT, "slack-inbox.jsonl"), JSON.stringify({ channel: m.channel, user: m.user, ts: m.ts, text: m.text }) + "\n");
});

await app.start();
botUserId = (await app.client.auth.test()).user_id ?? "";
console.log("Johnny is connected to Slack (Socket Mode).");
