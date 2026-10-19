import fs from "node:fs";
import path from "node:path";
import type Anthropic from "@anthropic-ai/sdk";
import { chromium, type Browser, type Page } from "playwright";
import { CHARTER } from "../charter";
import { client, MODEL, structured, track } from "../llm";

// Johnny with nothing but a link: he walks the product's main flow like a first-time user, then gives
// a designer's review on the screenshots and sketches two redesign directions on the real page.
// Nothing to install and nothing to trust him with, so it's the first thing a team sees.
// He never pays, books, signs up or submits personal data: those clicks are blocked, not just discouraged.

export interface UrlReviewOptions {
  url: string;
  goal?: string; // e.g. "buy a t-shirt"; otherwise he works out the main flow himself
  outDir: string;
  maxSteps?: number;
  onStep?: (line: string) => void;
}

interface Marked { n: number; tag: string; text: string; box: { x: number; y: number; w: number; h: number } }
interface Look { id: number; url: string; title: string; shot: string; marked: string; snapshot: string; elements: Marked[]; scrollY: number }

export interface Finding {
  title: string; look: number; elements: number[]; impact: "high" | "medium" | "low";
  user_sees: string; why_it_matters: string; evidence: { claim: string; source: string }[];
}
export interface UrlReview {
  product_summary: string;
  flow: string[];
  findings: Finding[];
  chosen: string;
  redesign: { look: number; element: number; levels_up: number };
  directions: { id: "A" | "B"; name: string; idea: string; gives_up: string }[];
}

const VIEWPORT = { width: 1280, height: 800 };
const BLOCKED_CLICK = /\b(pay|place (your )?order|complete (order|purchase|checkout)|confirm (order|payment|booking)|submit (order|payment)|sign ?up|create (an )?account|register|subscribe|delete|unsubscribe)\b/i;
const BLOCKED_INPUT = /password|card|cc-|cvc|cvv|expir|iban|ssn|phone|tel/i;

const REVIEW_SCHEMA = {
  type: "object", additionalProperties: false,
  required: ["product_summary", "flow", "findings", "chosen", "redesign", "directions"],
  properties: {
    product_summary: { type: "string", description: "What the product is and who uses it, in one or two sentences" },
    flow: { type: "array", items: { type: "string" }, description: "The steps you walked, in order, each with its look id" },
    findings: {
      type: "array",
      items: {
        type: "object", additionalProperties: false,
        required: ["title", "look", "elements", "impact", "user_sees", "why_it_matters", "evidence"],
        properties: {
          title: { type: "string", description: "The problem from the user's side" },
          look: { type: "integer", description: "The look id where it shows" },
          elements: { type: "array", items: { type: "integer" }, description: "Numbered elements on that look to mark; may be empty" },
          impact: { type: "string", enum: ["high", "medium", "low"] },
          user_sees: { type: "string" },
          why_it_matters: { type: "string" },
          evidence: { type: "array", items: { type: "object", additionalProperties: false, required: ["claim", "source"],
            properties: { claim: { type: "string" }, source: { type: "string", description: 'e.g. "look:3" or "look:3#12"' } } } },
        },
      },
    },
    chosen: { type: "string", description: "Title of the finding most worth redesigning now" },
    redesign: {
      type: "object", additionalProperties: false, required: ["look", "element", "levels_up"],
      description: "The part of the page to sketch: a numbered element on a look, and how many parent levels up to take so the whole component or section is included",
      properties: { look: { type: "integer" }, element: { type: "integer" }, levels_up: { type: "integer" } },
    },
    directions: {
      type: "array",
      items: { type: "object", additionalProperties: false, required: ["id", "name", "idea", "gives_up"],
        properties: { id: { type: "string", enum: ["A", "B"] }, name: { type: "string" }, idea: { type: "string" }, gives_up: { type: "string" } } },
    },
  },
} as const;

const launch = () => chromium.launch(process.env.PLAYWRIGHT_BROWSERS_PATH ? { executablePath: `${process.env.PLAYWRIGHT_BROWSERS_PATH}/chromium` } : {});

// Numbers the visible interactive elements, tags them with data-johnny-n, and returns where they are.
async function markElements(page: Page): Promise<Marked[]> {
  return page.evaluate(() => {
    document.querySelectorAll("[data-johnny-n]").forEach((el) => el.removeAttribute("data-johnny-n"));
    const sel = "a[href], button, input, select, textarea, [role=button], [role=link], [role=tab], [role=option], [role=radio], [role=checkbox], summary, label";
    const out: { n: number; tag: string; text: string; box: { x: number; y: number; w: number; h: number } }[] = [];
    for (const el of Array.from(document.querySelectorAll<HTMLElement>(sel))) {
      const r = el.getBoundingClientRect();
      const style = getComputedStyle(el);
      if (r.width < 4 || r.height < 4 || r.bottom < 0 || r.top > innerHeight || r.right < 0 || r.left > innerWidth) continue;
      if (style.visibility === "hidden" || style.display === "none" || Number(style.opacity) === 0) continue;
      const n = out.length + 1;
      el.setAttribute("data-johnny-n", String(n));
      const input = el as HTMLInputElement;
      const text = (el.getAttribute("aria-label") || el.innerText || input.placeholder || input.value || el.getAttribute("title") || el.getAttribute("alt") || "").trim().replace(/\s+/g, " ").slice(0, 80);
      const tag = el.tagName.toLowerCase() + (input.type && el.tagName === "INPUT" ? `[${input.type}]` : "") + (el.getAttribute("role") ? `[role=${el.getAttribute("role")}]` : "");
      out.push({ n, tag, text, box: { x: r.x, y: r.y, w: r.width, h: r.height } });
    }
    return out;
  });
}

// Set-of-marks: a numbered badge on each element, for the copy the model sees.
async function withBadges(page: Page, elements: Marked[], file: string) {
  await page.evaluate((els) => {
    const layer = document.createElement("div");
    layer.id = "johnny-badges";
    layer.style.cssText = "position:fixed;inset:0;pointer-events:none;z-index:2147483647";
    for (const e of els) {
      const b = document.createElement("div");
      b.textContent = String(e.n);
      b.style.cssText = `position:fixed;left:${Math.max(0, e.box.x - 2)}px;top:${Math.max(0, e.box.y - 2)}px;background:#e11d48;color:#fff;font:bold 11px/14px sans-serif;padding:0 3px;border-radius:3px`;
      const o = document.createElement("div");
      o.style.cssText = `position:fixed;left:${e.box.x}px;top:${e.box.y}px;width:${e.box.w}px;height:${e.box.h}px;outline:1px solid rgba(225,29,72,.6)`;
      layer.append(o, b);
    }
    document.body.append(layer);
  }, elements);
  await page.screenshot({ path: file });
  await page.evaluate(() => document.getElementById("johnny-badges")?.remove());
}

export async function reviewUrl(opts: UrlReviewOptions) {
  const maxSteps = opts.maxSteps ?? 18;
  const shots = path.join(opts.outDir, "shots");
  fs.mkdirSync(shots, { recursive: true });
  const origin = new URL(opts.url).origin;
  const browser: Browser = await launch();
  const context = await browser.newContext({ viewport: VIEWPORT, locale: "en-US" });
  const page = await context.newPage();
  const looks: Look[] = [];

  const look = async (): Promise<Anthropic.Beta.BetaToolResultBlockParam["content"]> => {
    await page.waitForLoadState("domcontentloaded").catch(() => {});
    await page.waitForTimeout(1200);
    const elements = await markElements(page);
    const id = looks.length + 1;
    const shot = path.join(shots, `look-${id}.png`);
    const marked = path.join(shots, `look-${id}-marked.png`);
    await page.screenshot({ path: shot });
    await withBadges(page, elements, marked);
    const snapshot = path.join(shots, `look-${id}.html`);
    const html = (await page.content()).replace(/<script\b[\s\S]*?<\/script>/gi, "").replace(/<head([^>]*)>/i, `<head$1><base href="${page.url()}">`);
    fs.writeFileSync(snapshot, html);
    const scrollY: number = await page.evaluate(() => window.scrollY);
    looks.push({ id, url: page.url(), title: await page.title(), shot, marked, snapshot, elements, scrollY });
    return [
      { type: "image", source: { type: "base64", media_type: "image/png", data: fs.readFileSync(marked).toString("base64") } },
      { type: "text", text: `look:${id}  ${page.url()}  "${await page.title()}"  (scrolled ${scrollY}px)\n` +
        elements.map((e) => `${e.n}. ${e.tag} "${e.text}"`).join("\n") },
    ];
  };

  const target = (n: number) => page.locator(`[data-johnny-n="${n}"]`).first();
  const act = async (name: string, input: Record<string, unknown>): Promise<Anthropic.Beta.BetaToolResultBlockParam["content"]> => {
    const el = looks.at(-1)?.elements.find((e) => e.n === Number(input.n));
    switch (name) {
      case "look": return look();
      case "click": {
        if (!el) return `No element ${input.n} on the last look.`;
        if (BLOCKED_CLICK.test(el.text)) return `Blocked: "${el.text}" would pay, book, sign up, submit or delete. Stop before this step and review what you saw.`;
        await target(el.n).click({ timeout: 5000 }).catch((e) => { throw new Error(`click failed: ${(e as Error).message.split("\n")[0]}`); });
        await page.waitForTimeout(800);
        if (!page.url().startsWith(origin)) return `That left the site (${page.url()}). Go back.` + "\n" + JSON.stringify(await look());
        return look();
      }
      case "type": {
        if (!el) return `No element ${input.n} on the last look.`;
        const attrs = await target(el.n).evaluate((x) => `${(x as HTMLInputElement).type} ${x.getAttribute("name")} ${x.getAttribute("autocomplete")} ${x.id}`);
        if (BLOCKED_INPUT.test(attrs) || /@/.test(String(input.text))) return "Blocked: don't enter passwords, payment, contact or other personal details.";
        await target(el.n).fill(String(input.text), { timeout: 5000 });
        if (input.enter) await target(el.n).press("Enter");
        return look();
      }
      case "scroll": {
        await page.mouse.wheel(0, input.direction === "up" ? -600 : 600);
        return look();
      }
      case "go_to": {
        const url = new URL(String(input.url), page.url());
        if (url.origin !== origin) return `Stay on ${origin}.`;
        await page.goto(url.toString(), { waitUntil: "domcontentloaded" });
        return look();
      }
      case "back": {
        await page.goBack({ waitUntil: "domcontentloaded" }).catch(() => {});
        return look();
      }
    }
    return `Unknown tool ${name}`;
  };

  const tools = [
    { name: "look", description: "Screenshot the current view, with numbered interactive elements.", input_schema: { type: "object", additionalProperties: false, properties: {}, required: [] } },
    { name: "click", description: "Click a numbered element from the last look.", input_schema: { type: "object", additionalProperties: false, required: ["n"], properties: { n: { type: "integer" } } } },
    { name: "type", description: "Type into a numbered field (search boxes and the like; never personal details). enter=true presses Enter.", input_schema: { type: "object", additionalProperties: false, required: ["n", "text"], properties: { n: { type: "integer" }, text: { type: "string" }, enter: { type: "boolean" } } } },
    { name: "scroll", description: "Scroll the page down or up by about two thirds of a screen.", input_schema: { type: "object", additionalProperties: false, required: ["direction"], properties: { direction: { type: "string", enum: ["down", "up"] } } } },
    { name: "go_to", description: "Open a URL on the same site.", input_schema: { type: "object", additionalProperties: false, required: ["url"], properties: { url: { type: "string" } } } },
    { name: "back", description: "Browser back.", input_schema: { type: "object", additionalProperties: false, properties: {}, required: [] } },
    { name: "submit_review", description: "Submit your review when you've walked the flow. Call it once.", input_schema: REVIEW_SCHEMA, strict: true },
  ];

  const system = `${CHARTER}

---

You've been given only a link to a product. Walk its main flow as a first-time user would
${opts.goal ? `(goal: ${opts.goal})` : "(work out from the first screen what the core thing a user comes to do is)"}, then review it as its designer.

Walking:
- Use look, click, type, scroll, go_to and back. Each look returns a screenshot with numbered elements.
- Go as far as a real user would, but stop before anything that pays, books, signs up, subscribes or
  submits personal details; those clicks are blocked anyway. Reaching the step before is enough.
- Look closely at each screen: what's first, what's unclear, what's missing, what the user has to guess.
  Notice feedback after actions (did adding, filtering or choosing visibly do something?), empty and
  loading states, and consistency between screens. Scroll where content continues.
- You have about ${maxSteps} steps. Spend them on the main flow, not on footers or legal pages.

Reviewing:
- Findings are problems from the user's side, ranked by how much they hurt the core flow. Only what
  you saw: cite "look:N" or "look:N#element". No invented metrics or user quotes; impact is your
  judgement, so say why. A product with no problems worth fixing is a fine answer: say so.
- Choose one to redesign now, point at the part of the page to sketch (an element on that look and how
  many parent levels up make the whole component or section), and propose two genuinely different
  design directions A and B, each with what it gives up.`;

  const messages: Anthropic.Beta.BetaMessageParam[] = [
    { role: "user", content: [{ type: "text", text: `Product: ${opts.url}\nHere is the first screen.` }, ...(await (async () => {
      await page.goto(opts.url, { waitUntil: "domcontentloaded" });
      return (await look()) as unknown as Anthropic.Beta.BetaContentBlockParam[];
    })())] },
  ];
  let review: UrlReview | undefined;
  try {
    for (let step = 0; step < maxSteps && !review; step++) {
      if (step === maxSteps - 1) messages.push({ role: "user", content: "That's the last step: call submit_review now." });
      const response = await client().beta.messages.stream({
        model: MODEL, max_tokens: 32000,
        betas: ["server-side-fallback-2026-07-01"], fallbacks: "default",
        cache_control: { type: "ephemeral" },
        system, output_config: { effort: "high" },
        tools: tools as unknown as Anthropic.Beta.BetaTool[], messages,
      }).finalMessage();
      track(response);
      if (response.stop_reason === "refusal") throw new Error("Model declined the request");
      messages.push({ role: "assistant", content: response.content });
      const uses = response.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use");
      if (!uses.length) { messages.push({ role: "user", content: "Keep walking with the tools, or call submit_review." }); continue; }
      const results: Anthropic.Beta.BetaToolResultBlockParam[] = [];
      for (const u of uses) {
        const input = u.input as Record<string, unknown>;
        if (u.name === "submit_review") { review = input as unknown as UrlReview; results.push({ type: "tool_result", tool_use_id: u.id, content: "Received." }); continue; }
        let content: Anthropic.Beta.BetaToolResultBlockParam["content"];
        try { content = await act(u.name, input); } catch (e) { content = `Error: ${(e as Error).message}`; }
        opts.onStep?.(`step ${step + 1}: ${u.name} ${JSON.stringify(input)} -> ${looks.at(-1)?.url ?? ""}`);
        results.push({ type: "tool_result", tool_use_id: u.id, content });
      }
      messages.push({ role: "user", content: results });
    }
    if (!review) throw new Error("No review submitted");
    const annotated = await annotate(browser, review, looks, shots);
    const sketches = await sketchDirections(browser, review, looks, shots);
    return { review, looks, annotated, sketches };
  } finally {
    await browser.close();
  }
}

// Each finding's elements, boxed and numbered on its clean screenshot.
async function annotate(browser: Browser, review: UrlReview, looks: Look[], dir: string) {
  const out: Record<number, string> = {};
  const byLook = new Map<number, { i: number; f: Finding }[]>();
  review.findings.forEach((f, i) => byLook.set(f.look, [...(byLook.get(f.look) ?? []), { i, f }]));
  const page = await browser.newPage({ viewport: VIEWPORT });
  for (const [id, items] of byLook) {
    const l = looks.find((x) => x.id === id);
    if (!l) continue;
    const boxes = items.flatMap(({ i, f }) => f.elements.map((n) => ({ i, e: l.elements.find((x) => x.n === n) })).filter((b) => b.e));
    const img = fs.readFileSync(l.shot).toString("base64");
    await page.setContent(`<body style="margin:0"><div style="position:relative;width:${VIEWPORT.width}px;height:${VIEWPORT.height}px">
      <img src="data:image/png;base64,${img}" style="display:block">
      ${boxes.map(({ i, e }) => `<div style="position:absolute;left:${e!.box.x - 3}px;top:${e!.box.y - 3}px;width:${e!.box.w + 6}px;height:${e!.box.h + 6}px;border:3px solid #f59e0b;border-radius:6px"></div>
        <div style="position:absolute;left:${e!.box.x - 14}px;top:${e!.box.y - 14}px;width:24px;height:24px;border-radius:12px;background:#f59e0b;color:#111;font:bold 14px/24px sans-serif;text-align:center">${i + 1}</div>`).join("")}
    </div></body>`);
    out[id] = path.join(dir, `look-${id}-annotated.png`);
    await page.screenshot({ path: out[id] });
  }
  await page.close();
  return out;
}

// Both directions sketched on the real page: the chosen section's HTML is replaced in a snapshot of
// that screen (real CSS, no scripts) and screenshotted, next to the same section before.
async function sketchDirections(browser: Browser, review: UrlReview, looks: Look[], dir: string) {
  const l = looks.find((x) => x.id === review.redesign.look) ?? looks.at(-1)!;
  const page = await browser.newPage({ viewport: VIEWPORT });
  const open = async () => {
    await page.setContent(fs.readFileSync(l.snapshot, "utf8"), { waitUntil: "load", timeout: 30000 }).catch(() => {});
    await page.waitForTimeout(1000);
    await page.evaluate((y) => scrollTo(0, y), l.scrollY);
  };
  await open();
  const pick = `(() => { let el = document.querySelector('[data-johnny-n="${review.redesign.element}"]'); for (let i = 0; i < ${Math.max(0, Math.min(8, review.redesign.levels_up))} && el?.parentElement && el.parentElement !== document.body; i++) el = el.parentElement; return el; })()`;
  let html = await page.evaluate(`(${pick})?.outerHTML ?? ""`) as string;
  if (!html) throw new Error("Couldn't find the section to sketch");
  html = html.replace(/\sdata-johnny-n="\d+"/g, "");
  if (html.length > 60000) html = html.slice(0, 60000);
  const before = path.join(dir, "sketch-before.png");
  await page.screenshot({ path: before });

  const chosen = review.findings.find((f) => f.title === review.chosen) ?? review.findings[0];
  const r = await structured<{ a_html: string; b_html: string; notes: string }>(
    `Sketch two redesign directions by rewriting one section of a real page's HTML. Return the new outer
HTML of the section for direction A and for direction B. Keep the page's own classes and styles so the
sketch looks like the product; change structure, hierarchy, copy and states as the direction needs.
Static HTML only, no scripts; show the state that best explains the direction. In "notes", one sentence
per direction on what you changed.`,
    [{ type: "text", text: `Problem: ${chosen.title}\nUser sees: ${chosen.user_sees}\n\n` +
      review.directions.map((d) => `Direction ${d.id}: ${d.name}: ${d.idea}`).join("\n") + `\n\nThe screen now:` },
     { type: "image", source: { type: "base64", media_type: "image/png", data: fs.readFileSync(before).toString("base64") } },
     { type: "text", text: `Section HTML:\n${html}` }],
    { type: "object", additionalProperties: false, required: ["a_html", "b_html", "notes"],
      properties: { a_html: { type: "string" }, b_html: { type: "string" }, notes: { type: "string" } } },
    "medium",
  );
  const files: Record<string, string> = { before };
  for (const [id, newHtml] of [["A", r.a_html], ["B", r.b_html]] as const) {
    await open();
    await page.evaluate(([sel, h]) => { const el = eval(sel) as HTMLElement | null; if (el) el.outerHTML = h; }, [pick, newHtml]);
    await page.waitForTimeout(400);
    files[id] = path.join(dir, `sketch-${id}.png`);
    await page.screenshot({ path: files[id] });
  }
  await page.close();
  return { files, notes: r.notes };
}
