import fs from "node:fs";
import path from "node:path";
import { WebClient } from "@slack/web-api";
import { costUSD, usage } from "../llm";
import { OUT } from "../paths";
import { backfillChannel, importExport } from "./slackHistory";
import { learn } from "./learn";
import { openingMessage } from "./opening";

// Johnny's first hour, from the command line: read history, learn from it, write the opening message.
//   tsx src/learn/catchup.ts --export <unzipped Slack export dir>
//   tsx src/learn/catchup.ts --channel <channel id> [--days 90]
//   add --post <channel id> to post the opening message there.
const arg = (name: string) => { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] : undefined; };
const t0 = Date.now();
const lap = (s: string) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s] ${s}`);
const slack = () => new WebClient(process.env.JOHNNY_SLACK_BOT_TOKEN);

const read = arg("--export")
  ? importExport(path.resolve(arg("--export")!))
  : [await backfillChannel(slack(), arg("--channel")!, { days: Number(arg("--days") ?? 90) })];
const summary = { channels: read.map((r) => `#${r.channel}`), messages: read.reduce((n, r) => n + r.messages, 0), weeks: Math.max(...read.map((r) => r.weeks)) };
lap(`read ${summary.messages} messages over ${summary.weeks} weeks in ${summary.channels.join(", ")}`);

const l = await learn((s) => lap(s));
lap(`learned: ${l.newSources} new sources, ${l.newEntries} new entries, ${l.newConflicts} new conflicts`);

const opening = await openingMessage(l.knowledge, summary);
lap(`opening message (${opening.checks.length} decisions checked in the code)`);
for (const c of opening.checks) console.log(`  ${c.reflected.padEnd(7)} ${c.title}`);
console.log(`\n${opening.text}\n`);
fs.writeFileSync(path.join(OUT, "opening.json"), JSON.stringify({ summary, ...opening }, null, 2));

if (arg("--post")) {
  await slack().chat.postMessage({ channel: arg("--post")!, text: opening.text });
  lap(`posted to ${arg("--post")}`);
}
console.log(`cost: ${usage.calls} calls, $${costUSD().toFixed(2)}`);
