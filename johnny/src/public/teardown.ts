import fs from "node:fs";
import path from "node:path";
import { costUSD, structured, imageBlocks } from "../llm";
import { OUT } from "../paths";
import { hnComments, themes, type Theme } from "./hn";
import { reviewUrl } from "../url/review";

// A public teardown, drafted for a person to approve: what users say about a product in public, checked on
// the product itself, and one improvement sketched on the real page. Johnny talks about products in public;
// he doesn't tag them or post on his own.
//   tsx src/public/teardown.ts <url> <product name> [--goal "..."]
const [url, product] = [process.argv[2], process.argv[3]];
const arg = (n: string) => { const i = process.argv.indexOf(n); return i >= 0 ? process.argv[i + 1] : undefined; };
const outDir = path.join(OUT, "teardown", new URL(url).hostname);
fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });
const t0 = Date.now();
const lap = (s: string) => console.log(`[${((Date.now() - t0) / 1000).toFixed(0)}s] ${s}`);

const voices = await hnComments(product);
const found: Theme[] = await themes(product, voices);
lap(`public voice: ${voices.length} HN comments, ${found.length} themes`);
const feedback = found.map((t, i) => `feedback:${i + 1} [${t.kind}, ${t.mentions} comments] ${t.theme}\n` +
  t.quotes.slice(0, 2).map((q) => `  "${q.text}" (${q.author}, ${q.date}, ${q.link})`).join("\n")).join("\n");

const r = await reviewUrl({ url, outDir, goal: arg("--goal"), context: feedback, maxSteps: 22, onStep: (l) => console.log(`  ${l}`) });
lap(`walked ${r.looks.length} screens, chose "${r.review.chosen}"`);

interface Post { text: string; image: string }
const images = { ...Object.fromEntries(Object.entries(r.annotated).map(([id, f]) => [`look:${id}`, f])),
  "sketch:before": r.sketches.files.before, "sketch:A": r.sketches.files.A, "sketch:B": r.sketches.files.B };
const write = (extra = "") => structured<{ posts: Post[] }>(
  `You're Johnny, an AI product designer, writing a thread for X about ${product}. A person will review it before
anything is posted. Goal: people who build products stop, learn something, and want this for their own product.

- Post 1 hooks with the most striking thing users say (with how many public comments said it) and what you
  found on the product. Say early, briefly, that you're an AI product designer.
- Then: what users see (with a screenshot), why it matters, and one improvement with the sketch. Show both
  directions only if they're genuinely different and fit.
- Respectful: it's a product people love. "Here's how I'd improve it", never "this is broken". Credit what works.
- No @mentions of anyone, no hashtags. Quotes only exactly as given, with the author's handle.
- Last post: sources (the comment links you quoted) and one line about what you are.
- 4 to 7 posts, each at most 270 characters. "image" is one of: ${Object.keys(images).join(", ")}, or "".
${extra}`,
  [...imageBlocks([r.annotated[r.review.redesign.look] ?? r.sketches.files.before, r.sketches.files.before, r.sketches.files.A, r.sketches.files.B].filter((f) => f && fs.existsSync(f))),
   { type: "text", text: `Public feedback:\n${feedback}\n\nYour review of the product:\n${JSON.stringify(r.review, null, 1)}\n\nSketch notes: ${r.sketches.notes}` }],
  { type: "object", additionalProperties: false, required: ["posts"], properties: { posts: { type: "array", items: {
    type: "object", additionalProperties: false, required: ["text", "image"], properties: { text: { type: "string" }, image: { type: "string" } } } } } },
  "medium",
);
let { posts } = await write();
const tooLong = posts.filter((p) => [...p.text].length > 280);
if (tooLong.length) ({ posts } = await write(`\nYour last draft had posts over 280 characters: ${tooLong.map((p) => [...p.text].length).join(", ")}. Shorten them.`));

// The draft: a thread to read and approve, with its images next to each post.
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
const img = (k: string) => { const f = (images as Record<string, string | undefined>)[k]; return f && fs.existsSync(f) ? `<img src="data:image/png;base64,${fs.readFileSync(f).toString("base64")}">` : ""; };
const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Johnny thread draft</title>
<style>:root{--bg:#f7f9f9;--card:#fff;--fg:#0f1419;--muted:#536471;--line:#eff3f4}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){--bg:#000;--card:#16181c;--fg:#e7e9ea;--muted:#71767b;--line:#2f3336}}
:root[data-theme="dark"]{--bg:#000;--card:#16181c;--fg:#e7e9ea;--muted:#71767b;--line:#2f3336}
body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.45 system-ui,-apple-system,sans-serif}main{max-width:600px;margin:0 auto;padding:24px 16px}
.post{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:14px 16px;margin:10px 0}.who{font-weight:700}.who span{color:var(--muted);font-weight:400}
.text{white-space:pre-wrap;margin:6px 0}img{max-width:100%;border-radius:12px;border:1px solid var(--line);margin-top:8px}.n{color:var(--muted);font-size:13px}
.note{color:var(--muted);font-size:13px;margin-bottom:16px}</style></head><body><main>
<p class="note">Draft for approval: nothing has been posted. ${posts.length} posts · ${product} · ${new Date().toISOString().slice(0, 10)}</p>
${posts.map((p, i) => `<div class="post"><div class="who">Johnny <span>@johnny · AI product designer</span></div><div class="text">${esc(p.text)}</div>${p.image ? img(p.image) : ""}<div class="n">${i + 1}/${posts.length} · ${[...p.text].length} chars</div></div>`).join("\n")}
</main></body></html>`;
fs.writeFileSync(path.join(outDir, "thread.html"), html);
fs.writeFileSync(path.join(outDir, "thread.json"), JSON.stringify({ product, url, posts, feedback: found, review: r.review }, null, 2));
lap(`draft: ${posts.length} posts (${posts.map((p) => [...p.text].length).join(", ")} chars) -> out/teardown/${new URL(url).hostname}/thread.html · $${costUSD().toFixed(2)}`);
for (const p of posts) console.log(`\n${p.text}${p.image ? `\n[${p.image}]` : ""}`);
