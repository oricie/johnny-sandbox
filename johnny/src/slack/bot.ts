import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { App, Assistant, type SayFn } from "@slack/bolt";
import type { WebClient } from "@slack/web-api";
import { OUT, ROOT } from "../paths";
import { runJohnny, type RunResult } from "../pipeline";
import { reply, type Turn } from "../agent/agent";
import { prototype } from "../prototype";
import { sketch } from "../sketch";
import { buildSlackMessage } from "../report/slack";
import { checkCitations } from "../guard/citations";
import { loadKnowledge } from "../observe/knowledge";
import { backfillChannel } from "../learn/slackHistory";
import { learn } from "../learn/learn";
import { openingMessage } from "../learn/opening";

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
const log = (...a: unknown[]) => console.log(new Date().toISOString(), ...a);

// Every incoming event, so the log shows what arrived and what was handled.
app.use(async ({ body, next }) => {
  const b = body as { type?: string; event?: { type?: string; subtype?: string; channel?: string; ts?: string; thread_ts?: string; text?: string }; command?: string; actions?: { action_id: string }[] };
  const e = b.event;
  log("event", b.type, e?.type ?? b.command ?? b.actions?.[0]?.action_id ?? "", e?.subtype ?? "", e?.channel ?? "", e?.thread_ts ? "thread" : "", e?.text ? `${e.text.length} chars` : "");
  await next();
});
app.error(async (err) => { log("ERROR", err.message, (err as { original?: Error }).original?.stack ?? err.stack ?? ""); });
let busy = false; // one run at a time: both options share the same worktrees
const runs = new Map<string, RunResult>(); // thread ts -> last run, for the approve buttons
// Runs are also kept on disk so buttons in older threads keep working after a restart.
const runFile = (thread: string) => path.join(OUT, "runs", `${thread}.json`);
function saveRun(thread: string, r: RunResult) {
  runs.set(thread, r);
  fs.mkdirSync(path.dirname(runFile(thread)), { recursive: true });
  fs.writeFileSync(runFile(thread), JSON.stringify(r));
}
function loadRun(thread: string): RunResult | undefined {
  if (runs.has(thread)) return runs.get(thread);
  try { const r = JSON.parse(fs.readFileSync(runFile(thread), "utf8")) as RunResult; runs.set(thread, r); return r; } catch { return undefined; }
}
const threads = new Set<string>(); // threads Johnny is part of: he answers there without a mention
let botUserId = "";

const threadImages = new Map<string, string[]>(); // thread ts -> image files downloaded from it

// Downloads image attachments (needs files:read) so they can be shown to the model.
async function downloadImages(files: { id?: string; mimetype?: string; url_private_download?: string; url_private?: string }[] = []) {
  const out: string[] = [];
  for (const f of files) {
    const url = f.url_private_download ?? f.url_private;
    if (!f.id || !url || !/^image\/(png|jpe?g|gif|webp)$/.test(f.mimetype ?? "")) continue;
    const file = path.join(OUT, "slack-images", `${f.id}.${f.mimetype!.split("/")[1].replace("jpeg", "jpg")}`);
    if (!fs.existsSync(file)) {
      const res = await fetch(url, { headers: { Authorization: `Bearer ${botToken}` } });
      const type = res.headers.get("content-type") ?? "";
      if (!res.ok || !type.startsWith("image/")) continue; // e.g. an HTML login page when files:read is missing
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length > 4_500_000) continue; // the API's per-image limit is 5 MB
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, buf);
    }
    out.push(file);
  }
  return out;
}

async function run(client: WebClient, channel: string, thread: string, request?: string) {
  if (busy) {
    await client.chat.postMessage({ channel, thread_ts: thread, text: "I'm in the middle of another run. Try again in a couple of minutes." });
    return;
  }
  busy = true;
  const status = await client.chat.postMessage({ channel, thread_ts: thread, text: "👀 Reading the product, the context and the usage data…" });
  const update = (text: string) => client.chat.update({ channel, ts: status.ts!, text });
  try {
    const images = request ? threadImages.get(thread) ?? [] : [];
    const result = await runJohnny({
      request, images, act: true,
      onProgress: async (stage, detail) => {
        if (stage === "decided") await update("🧠 Decided. Building both options in separate branches and checking them…");
        if (stage === "acted") await update(`🛠️ Built (${detail}). Taking screenshots…`);
      },
    });
    saveRun(thread, result);
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
    for (const c of result.comparison ?? []) {
      const lines = [`*Option ${c.option} vs your image:* ${c.verdict}`,
        ...c.gaps.map((g) => `• gap: ${g}`), ...c.deliberate.map((d) => `• on purpose: ${d}`)];
      await client.chat.postMessage({ channel, thread_ts: thread, text: lines.join("\n") });
    }
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

// Exploration prototypes: several directions, each with a live link and a screenshot.
async function runPrototype(client: WebClient, channel: string, thread: string, brief: string, variants: number) {
  if (busy) {
    await client.chat.postMessage({ channel, thread_ts: thread, text: "I'm in the middle of another run. Try again in a couple of minutes." });
    return;
  }
  busy = true;
  const status = await client.chat.postMessage({ channel, thread_ts: thread, text: "🧪 Thinking of different directions…" });
  const update = (text: string) => client.chat.update({ channel, ts: status.ts!, text });
  try {
    const p = await prototype(brief, { variants, images: threadImages.get(thread) ?? [], onProgress: (s) => { void update(`🧪 ${s}`); } });
    if (!p.ok) {
      await update(`The prototypes didn't pass the checks:\n\`\`\`${p.checks.slice(0, 1500)}\`\`\``);
      return;
    }
    await update(`🧪 ${p.directions.length} directions, all built and checked. Exploration only: not for merging as is.`);
    const lines = p.directions.map((d, i) =>
      `*${i + 1}. ${d.title}*${d.preview ? `  <${d.preview}|▶ open live>` : ""}\n${d.idea}\n_${d.tradeoff}_`);
    await client.chat.postMessage({ channel, thread_ts: thread, text: lines.join("\n\n") +
      "\n\nTell me which direction to take further, or what to mix, and I'll turn it into a proper change." });
    const files = p.directions.map((d) => d.shot).filter((f): f is string => !!f && fs.existsSync(f));
    if (files.length) await client.files.uploadV2({ channel_id: channel, thread_ts: thread,
      file_uploads: files.map((f, i) => ({ file: f, filename: `${i + 1}-${path.basename(f)}` })) });
  } catch (e) {
    await update(`Something went wrong: ${(e as Error).message.slice(0, 500)}`);
  } finally {
    busy = false;
  }
}

// Johnny answers in threads he's part of. After a restart the in-memory set is empty,
// so look at the thread: if Johnny posted in it, it's his.
async function isJohnnysThread(client: WebClient, channel: string, thread: string) {
  if (threads.has(thread)) return true;
  try {
    const r = await client.conversations.replies({ channel, ts: thread, limit: 50 });
    const mine = (r.messages ?? []).some((m) => m.bot_id || m.user === botUserId);
    if (mine) threads.add(thread);
    return mine;
  } catch { return false; }
}

// The thread so far, as a conversation. Johnny's own messages are the assistant side.
async function threadHistory(client: WebClient, channel: string, thread: string, latest: string): Promise<Turn[]> {
  try {
    const r = await client.conversations.replies({ channel, ts: thread, limit: 50 });
    const turns: Turn[] = [];
    for (const m of r.messages ?? []) {
      const mine = !!m.bot_id || m.user === botUserId;
      const images = mine ? [] : await downloadImages(m.files as never);
      if (!m.text && !images.length) continue;
      turns.push({ role: mine ? "assistant" : "user", text: (m.text ?? "").replace(/<@[^>]+>/g, "").trim(), name: m.user, images });
    }
    const all = turns.flatMap((t) => t.images ?? []);
    if (all.length) threadImages.set(thread, all.slice(-4));
    if (turns.length && turns.at(-1)!.role === "user") return turns;
  } catch { /* fall through: no history access, answer the message alone */ }
  return [{ role: "user", text: latest }];
}

// His first hour in a channel: read its history, learn from it, check decisions against the product,
// and post what he found. Once per channel unless asked again.
const catchingUp = new Set<string>();
async function catchUp(client: WebClient, channel: string, thread?: string) {
  if (catchingUp.has(channel)) return "Already reading this channel; the summary will be posted when it's done.";
  catchingUp.add(channel);
  void (async () => {
    try {
      const read = await backfillChannel(client, channel, { days: 90, botUserId });
      log("catch-up read", channel, read);
      const l = await learn();
      const opening = await openingMessage(l.knowledge, { channels: [`#${read.channel}`], messages: read.messages, weeks: read.weeks });
      await client.chat.postMessage({ channel, ...(thread ? { thread_ts: thread } : {}), text: opening.text });
    } catch (e) {
      log("ERROR in catch-up", (e as Error).stack);
      await client.chat.postMessage({ channel, ...(thread ? { thread_ts: thread } : {}), text: `I couldn't finish reading the channel: ${(e as Error).message.slice(0, 200)}` }).catch(() => {});
    } finally {
      catchingUp.delete(channel);
    }
  })();
  return "Started reading the channel's last 90 days. The summary will be posted in the channel in a few minutes.";
}

// Every message is a turn in a conversation with Johnny. He decides whether to answer,
// look things up, or start a review or a build (through his tools).
async function handle(text: string, client: WebClient, channel: string, thread: string, say: SayFn) {
  threads.add(thread);
  log("handle", channel, thread, `${text.length} chars`);
  const history = await threadHistory(client, channel, thread, text.trim());
  const answer = await reply(history, {
    status: () => {
      const r = loadRun(thread);
      return { busy, runs: runs.size, lastFinding: [...runs.values()].at(-1)?.decision.chosen_finding,
        thisThread: r ? { finding: r.decision.chosen_finding, today: r.beforePreview,
          options: r.results.map((x) => ({ option: x.option, ok: x.ok, live: x.preview, branch: x.branch, changed: x.files, summary: x.summary })) } : undefined };
    },
    startRun: async (request) => {
      if (busy) return "Busy: another run is in progress. Tell the person to try again in a couple of minutes.";
      void run(client, channel, thread, request);
      return "Started. Progress and results will be posted in this thread in 2-3 minutes.";
    },
    sketch: async (change, route) => {
      const s = await sketch(change, route, threadImages.get(thread) ?? []);
      await client.files.uploadV2({ channel_id: channel, thread_ts: thread, initial_comment: `✏️ Sketch: ${s.notes}`,
        file_uploads: [{ file: s.file, filename: "sketch.png" }] });
      return `Sketch posted in the thread. What you changed: ${s.notes}. Ask whether to build it (a full build with two options takes 2-3 minutes).`;
    },
    catchUp: () => catchUp(client, channel, thread),
    startPrototype: async (brief, variants) => {
      if (busy) return "Busy: another run is in progress. Tell the person to try again in a couple of minutes.";
      void runPrototype(client, channel, thread, brief, variants);
      return "Started. The directions, live links and screenshots will be posted in this thread in about 3 minutes.";
    },
  });
  log("reply", thread, `${answer.length} chars`);
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
  await client.reactions.add({ channel: event.channel, timestamp: event.ts, name: "eyes" })
    .catch((e) => log("reaction failed", (e as Error).message));
  try {
    await handle(text, client, event.channel, event.thread_ts ?? event.ts, say);
  } catch (e) {
    log("ERROR in mention", (e as Error).stack);
    await say({ thread_ts: event.thread_ts ?? event.ts, text: `Something went wrong: ${(e as Error).message.slice(0, 300)}` }).catch(() => {});
  }
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
  const r = loadRun(thread)?.results.find((x) => x.option === option);
  if (!r?.ok) {
    await client.chat.postMessage({ channel, thread_ts: thread, text: `Option ${option} isn't available to approve.` });
    return;
  }
  try {
    execFileSync("git", ["push", "-f", "-q", "origin", r.branch], { cwd: ROOT });
    const repo = execFileSync("git", ["remote", "get-url", "origin"], { cwd: ROOT }).toString().trim().replace(/\.git$/, "");
    await client.chat.postMessage({ channel, thread_ts: thread,
      text: `✅ <@${b.user.id}> approved option ${option}.${r.preview ? ` Live: <${r.preview}|open option ${option}>.` : ""} Pushed \`${r.branch}\` (${r.sha}): ${repo}/compare/main...${r.branch}` });
  } catch (e) {
    await client.chat.postMessage({ channel, thread_ts: thread, text: `Approved, but pushing the branch failed: ${(e as Error).message.slice(0, 300)}` });
  }
});

// Added to a channel: introduce himself, then read its history and come back with what he found.
app.event("member_joined_channel", async ({ event, client }) => {
  if (event.user !== botUserId) return;
  log("joined", event.channel);
  await client.chat.postMessage({ channel: event.channel,
    text: "Hi, I'm Johnny, the team's product designer. I'm reading this channel's last 90 days so I know what's been said and decided. I'll be back here in a few minutes with what I found." });
  await catchUp(client, event.channel);
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
  // file_share: a message with an attachment (e.g. a screenshot); other subtypes are edits, joins, etc.
  if ((m.subtype && m.subtype !== "file_share") || m.bot_id || (!m.text && m.subtype !== "file_share")) return;
  // A reply in a thread Johnny is part of, without a mention (mentions go through app_mention).
  const mentioned = botUserId && (m.text ?? "").includes(`<@${botUserId}>`);
  if (m.thread_ts && !mentioned && m.channel_type !== "im" && await isJohnnysThread(client, m.channel, m.thread_ts)) {
    await handle(m.text ?? "", client, m.channel, m.thread_ts, say);
  }
  fs.mkdirSync(OUT, { recursive: true });
  if (m.text) fs.appendFileSync(path.join(OUT, "slack-inbox.jsonl"), JSON.stringify({ channel: m.channel, user: m.user, ts: m.ts, text: m.text }) + "\n");
});

await app.start();
botUserId = (await app.client.auth.test()).user_id ?? "";
console.log("Johnny is connected to Slack (Socket Mode).");
