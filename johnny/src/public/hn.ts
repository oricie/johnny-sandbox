import { structured } from "../llm";

// What people say about a product in public, from Hacker News comments (Algolia's open search API).
// Only comments that read like experience with the product are kept, and themes keep exact quotes and links.

export interface Voice { id: string; author: string; date: string; text: string; link: string }
export interface Theme { theme: string; kind: "pain" | "request" | "praise"; mentions: number; quotes: { text: string; author: string; date: string; link: string }[] }

const strip = (html: string) => html.replace(/<p>/g, "\n").replace(/<[^>]+>/g, "")
  .replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&gt;/g, ">").replace(/&lt;/g, "<").replace(/&amp;/g, "&").replace(/&#x2F;/g, "/");

export async function hnComments(product: string, max = 1000): Promise<Voice[]> {
  const out: Voice[] = [];
  for (let page = 0; out.length < max; page++) {
    const r = await fetch(`https://hn.algolia.com/api/v1/search?query=${encodeURIComponent(product)}&tags=comment&hitsPerPage=200&page=${page}`);
    const d = (await r.json()) as { hits: { objectID: string; author: string; created_at: string; comment_text?: string }[]; nbPages: number };
    for (const h of d.hits) {
      const text = strip(h.comment_text ?? "");
      if (text.toLowerCase().includes(product.toLowerCase())) out.push({ id: h.objectID, author: h.author, date: h.created_at.slice(0, 10), text, link: `https://news.ycombinator.com/item?id=${h.objectID}` });
    }
    if (page + 1 >= d.nbPages) break;
  }
  return out.slice(0, max);
}

// Comments that sound like using the product and wanting something different.
const EXPERIENCE = /\b(wish|annoy|frustrat|confus|can't|cannot|couldn't|hard to|missing|lack|hate|struggl|clunky|slow|bug|broken|only thing|my only|would love|feature request|if only|switched|instead of|problem with|issue with|doesn't|does not|don't like|workaround)\b/i;

export async function themes(product: string, voices: Voice[]): Promise<Theme[]> {
  const relevant = voices.filter((v) => EXPERIENCE.test(v.text)).slice(0, 250);
  const r = await structured<{ themes: Theme[] }>(
    `These are public Hacker News comments that mention ${product}. Find what people who actually use it say about
using it: recurring pains, requests, and what they love. Ignore comments that only mention it in passing,
compare it without saying anything about using it, or are about other products.
- Group by theme. "mentions" is how many distinct comments express it.
- Quotes are exact excerpts (one or two sentences) from the comments, with the author, date and link given.
- Order by mentions. Leave out themes with a single mention unless they're unusually specific and actionable.
- Product-experience themes only (what users see and do), not pricing, licensing or company news.`,
    relevant.map((v) => `[${v.link} | ${v.author} | ${v.date}]\n${v.text.slice(0, 1200)}`).join("\n\n---\n\n"),
    { type: "object", additionalProperties: false, required: ["themes"], properties: { themes: { type: "array", items: {
      type: "object", additionalProperties: false, required: ["theme", "kind", "mentions", "quotes"],
      properties: { theme: { type: "string" }, kind: { type: "string", enum: ["pain", "request", "praise"] }, mentions: { type: "integer" },
        quotes: { type: "array", items: { type: "object", additionalProperties: false, required: ["text", "author", "date", "link"],
          properties: { text: { type: "string" }, author: { type: "string" }, date: { type: "string" }, link: { type: "string" } } } } } } } } },
    "medium",
  );
  // Quotes must be real: keep only those that appear verbatim in the comment they link to.
  const byLink = new Map(voices.map((v) => [v.link, v.text.replace(/\s+/g, " ")]));
  return r.themes.map((t) => ({ ...t, quotes: t.quotes.filter((q) => byLink.get(q.link)?.includes(q.text.replace(/\s+/g, " ").replace(/^["“]|["”]$/g, "").replace(/\.\.\.$|…$/, "").trim())) }))
    .filter((t) => t.quotes.length);
}
