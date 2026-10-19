import fs from "node:fs";
import path from "node:path";
import { ROOT, OUT } from "../paths";
import { historySources } from "./slackHistory";

// Every source normalised to the same shape: an id, where it came from, when, and readable text.
// Adding Gong/Zendesk/etc. for real means replacing these loaders with API calls.
export interface SourceDoc { id: string; kind: "gong" | "zendesk" | "research" | "slack" | "slack-live"; date: string; title: string; text: string }

function gong(file: string, d: any): SourceDoc {
  const who = Object.fromEntries(d.participants.map((p: any) => [p.name, `${p.name} (${p.role}, ${p.company})`]));
  return { id: d.id, kind: "gong", date: d.date, title: `${d.title} [${d.account}]`,
    text: d.transcript.map((t: any) => `${who[t.speaker] ?? t.speaker}: ${t.text}`).join("\n") };
}

function zendesk(d: any): SourceDoc[] {
  return d.tickets.map((t: any) => ({ id: t.id, kind: "zendesk" as const, date: t.date, title: `${t.subject} [${t.account}]`,
    text: `From: ${t.requester_role} at ${t.account}\nTags: ${t.tags.join(", ")}\n\n${t.body}` }));
}

function slackExport(file: string, d: any): SourceDoc {
  return { id: `slack:${d.channel}:${d.date}`, kind: "slack", date: d.date, title: `Slack ${d.channel}`,
    text: d.messages.map((m: any) => `${m.user}: ${m.text}`).join("\n") };
}

function research(file: string, raw: string): SourceDoc {
  const meta = Object.fromEntries((/^---\n([\s\S]*?)\n---/.exec(raw)?.[1] ?? "").split("\n").map((l) => {
    const i = l.indexOf(":"); return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
  }));
  return { id: meta.id ?? path.basename(file), kind: "research", date: meta.date ?? "", title: meta.title ?? path.basename(file),
    text: raw.replace(/^---[\s\S]*?---\n/, "") };
}

export function loadSources(): SourceDoc[] {
  const dir = path.join(ROOT, "sources");
  const out: SourceDoc[] = [];
  for (const f of (fs.readdirSync(dir, { recursive: true }) as string[]).sort()) {
    const abs = path.join(dir, f);
    if (fs.statSync(abs).isDirectory() || f === "README.md") continue;
    const raw = fs.readFileSync(abs, "utf8");
    if (f.endsWith(".md")) { out.push(research(f, raw)); continue; }
    const d = JSON.parse(raw);
    if (d.source === "gong") out.push(gong(f, d));
    else if (d.source === "zendesk") out.push(...zendesk(d));
    else if (d.source === "slack") out.push(slackExport(f, d));
  }
  // Channel history he read when he joined (or from a workspace export), one source per channel per week.
  out.push(...historySources());
  // What Johnny heard in Slack channels he's invited to, one source per day.
  const inbox = path.join(OUT, "slack-inbox.jsonl");
  if (fs.existsSync(inbox)) {
    const byDay = new Map<string, string[]>();
    for (const line of fs.readFileSync(inbox, "utf8").split("\n").filter(Boolean)) {
      const m = JSON.parse(line);
      const day = new Date(Number(m.ts) * 1000).toISOString().slice(0, 10);
      byDay.set(day, [...(byDay.get(day) ?? []), `${m.user}: ${m.text}`]);
    }
    for (const [day, lines] of byDay) out.push({ id: `slack-live:${day}`, kind: "slack-live", date: day, title: `Slack (heard live) ${day}`, text: lines.join("\n") });
  }
  return out;
}
