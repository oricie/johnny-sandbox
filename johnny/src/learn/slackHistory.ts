import fs from "node:fs";
import path from "node:path";
import type { WebClient } from "@slack/web-api";
import { OUT } from "../paths";

// Reading what a team already said in Slack, so Johnny knows the product's history from his first hour.
// Two ways in: the Slack API for channels he's a member of, or a workspace export (the zip an admin can
// download, unzipped). Either way it's written as one source per channel per week under out/slack-history,
// which the learning step reads like any other source.

export const HISTORY_DIR = path.join(OUT, "slack-history");

interface Msg { user: string; ts: string; text: string; replies?: Msg[] }
export interface WeekFile { source: "slack-history"; channel: string; week: string; messages: Msg[] }

// ISO week start (Monday) of a Slack ts, as YYYY-MM-DD.
const weekOf = (ts: string) => {
  const d = new Date(Number(ts) * 1000);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
};

function writeWeeks(channel: string, messages: Msg[]) {
  const byWeek = new Map<string, Msg[]>();
  for (const m of messages.sort((a, b) => Number(a.ts) - Number(b.ts))) byWeek.set(weekOf(m.ts), [...(byWeek.get(weekOf(m.ts)) ?? []), m]);
  const dir = path.join(HISTORY_DIR, channel);
  fs.mkdirSync(dir, { recursive: true });
  for (const [week, msgs] of byWeek) {
    const file: WeekFile = { source: "slack-history", channel, week, messages: msgs };
    fs.writeFileSync(path.join(dir, `${week}.json`), JSON.stringify(file, null, 1));
  }
  return { channel, messages: messages.length + messages.reduce((n, m) => n + (m.replies?.length ?? 0), 0), weeks: byWeek.size };
}

// Slack text with <@U123> mentions turned into names.
const readable = (text: string, name: (id: string) => string) => text.replace(/<@([A-Z0-9]+)>/g, (_, id) => `@${name(id)}`);

export async function backfillChannel(client: WebClient, channelId: string, opts: { days?: number; botUserId?: string } = {}) {
  const info = await client.conversations.info({ channel: channelId });
  const channel = info.channel?.name ?? channelId;
  const oldest = String(Date.now() / 1000 - (opts.days ?? 90) * 86400);
  const names = new Map<string, string>();
  const name = (id: string) => names.get(id) ?? id;
  const resolve = async (id?: string) => {
    if (!id || names.has(id)) return;
    try {
      const u = await client.users.info({ user: id });
      names.set(id, `${u.user?.real_name || u.user?.name || id}${u.user?.profile?.title ? ` (${u.user.profile.title})` : ""}`);
    } catch { names.set(id, id); }
  };
  type Raw = { user?: string; bot_id?: string; subtype?: string; ts?: string; text?: string; reply_count?: number; thread_ts?: string };
  const human = (m: Raw) => !m.bot_id && !m.subtype && m.user !== opts.botUserId && !!m.text;

  const top: Raw[] = [];
  for (let cursor: string | undefined; ;) {
    const r = await client.conversations.history({ channel: channelId, oldest, limit: 200, cursor });
    top.push(...(r.messages ?? []) as Raw[]);
    cursor = r.response_metadata?.next_cursor || undefined;
    if (!cursor) break;
  }
  const messages: Msg[] = [];
  for (const m of top.filter(human)) {
    let replies: Raw[] = [];
    if (m.reply_count) {
      const r = await client.conversations.replies({ channel: channelId, ts: m.ts!, limit: 200 });
      replies = ((r.messages ?? []) as Raw[]).slice(1).filter(human);
    }
    for (const x of [m, ...replies]) {
      await resolve(x.user);
      for (const [, id] of (x.text ?? "").matchAll(/<@([A-Z0-9]+)>/g)) await resolve(id);
    }
    messages.push({ user: name(m.user!), ts: m.ts!, text: readable(m.text!, name),
      ...(replies.length ? { replies: replies.map((x) => ({ user: name(x.user!), ts: x.ts!, text: readable(x.text!, name) })) } : {}) });
  }
  return writeWeeks(channel, messages);
}

// An unzipped Slack export: users.json, channels.json, and <channel>/<YYYY-MM-DD>.json message arrays.
export function importExport(dir: string, only?: string[]) {
  const users = JSON.parse(fs.readFileSync(path.join(dir, "users.json"), "utf8")) as { id: string; real_name?: string; name: string; profile?: { title?: string } }[];
  const names = new Map(users.map((u) => [u.id, `${u.real_name || u.name}${u.profile?.title ? ` (${u.profile.title})` : ""}`]));
  const name = (id: string) => names.get(id) ?? id;
  const channels = (JSON.parse(fs.readFileSync(path.join(dir, "channels.json"), "utf8")) as { name: string }[])
    .map((c) => c.name).filter((c) => !only || only.includes(c));
  return channels.map((channel) => {
    type Raw = { user?: string; bot_id?: string; subtype?: string; ts: string; text?: string; thread_ts?: string };
    const raw: Raw[] = fs.readdirSync(path.join(dir, channel)).filter((f) => f.endsWith(".json")).sort()
      .flatMap((f) => JSON.parse(fs.readFileSync(path.join(dir, channel, f), "utf8")));
    const human = raw.filter((m) => !m.bot_id && !m.subtype && m.text);
    const tops = human.filter((m) => !m.thread_ts || m.thread_ts === m.ts);
    const messages: Msg[] = tops.map((m) => {
      const replies = human.filter((r) => r.thread_ts === m.ts && r.ts !== m.ts);
      return { user: name(m.user!), ts: m.ts, text: readable(m.text!, name),
        ...(replies.length ? { replies: replies.map((r) => ({ user: name(r.user!), ts: r.ts, text: readable(r.text!, name) })) } : {}) };
    });
    return writeWeeks(channel, messages);
  });
}

// Week files as readable text for the learning step.
export function historySources() {
  if (!fs.existsSync(HISTORY_DIR)) return [];
  return fs.readdirSync(HISTORY_DIR).flatMap((channel) => fs.readdirSync(path.join(HISTORY_DIR, channel)).filter((f) => f.endsWith(".json")).map((f) => {
    const w = JSON.parse(fs.readFileSync(path.join(HISTORY_DIR, channel, f), "utf8")) as WeekFile;
    const day = (ts: string) => new Date(Number(ts) * 1000).toISOString().slice(0, 10);
    const text = w.messages.map((m) => `[${day(m.ts)}] ${m.user}: ${m.text}` +
      (m.replies ?? []).map((r) => `\n    ↳ ${r.user}: ${r.text}`).join("")).join("\n");
    return { id: `slack:#${w.channel}:${w.week}`, kind: "slack" as const, date: w.week, title: `Slack #${w.channel}, week of ${w.week}`, text };
  }));
}
