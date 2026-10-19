import fs from "node:fs";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { launchBrowser } from "./browser";
import { ROOT, OUT } from "./paths";
import { structured, imageBlocks } from "./llm";

// A quick visual sketch of a change, in about half a minute instead of a full build:
// take the screen's real rendered HTML and CSS, let Johnny edit the markup, and screenshot it.
// Static (no behaviour, no checks): it shows how it would look, so people can react before he builds.

const VITE = path.join(ROOT, "node_modules/.bin/vite");
const launch = launchBrowser;

async function currentScreen(route: string) {
  const app = path.join(ROOT, "demo-app");
  const build = spawnSync(VITE, ["build", "--logLevel", "error"], { cwd: app, encoding: "utf8" });
  if (build.status !== 0) throw new Error(`build failed: ${build.stderr}`);
  const assets = path.join(app, "dist", "assets");
  const css = fs.readdirSync(assets).filter((f) => f.endsWith(".css")).map((f) => fs.readFileSync(path.join(assets, f), "utf8")).join("\n");
  const port = 4320;
  const server = spawn(VITE, ["preview", "--port", String(port), "--strictPort"], { cwd: app, stdio: "ignore" });
  try {
    for (let i = 0; i < 60; i++) {
      try { if ((await fetch(`http://localhost:${port}/`)).ok) break; } catch { /* starting */ }
      await new Promise((r) => setTimeout(r, 250));
    }
    const browser = await launch();
    const page = await browser.newPage({ viewport: { width: 1100, height: 620 } });
    await page.goto(`http://localhost:${port}/#${route}`);
    await page.waitForTimeout(700);
    const html = await page.$eval("#root", (el) => el.innerHTML);
    await browser.close();
    return { html, css };
  } finally {
    server.kill();
  }
}

export async function sketch(change: string, route: string, images: string[] = []): Promise<{ file: string; notes: string }> {
  const { html, css } = await currentScreen(route);
  const tokens = fs.readFileSync(path.join(ROOT, "demo-app/src/styles/tokens.css"), "utf8");
  const r = await structured<{ html: string; notes: string }>(
    `Make a quick visual sketch of a proposed change by editing the screen's current rendered HTML.
Return the new inner HTML of #root. Change only what the change needs; keep everything else identical.
Use the existing classes and CSS variables from tokens.css (style="..." with var(--...) is fine); no
scripts. It is static: show the state that best explains the change. In "notes", one or two sentences
on what you changed, in the language of the request.`,
    [...imageBlocks(images), { type: "text", text:
      `Change: ${change}\nScreen: #${route}\n\ntokens.css:\n${tokens}\n\nCurrent #root HTML:\n${html}` }],
    { type: "object", additionalProperties: false, required: ["html", "notes"],
      properties: { html: { type: "string" }, notes: { type: "string" } } },
    "low",
  );
  const file = path.join(OUT, "sketches", `${Date.now()}.png`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const browser = await launch();
  const page = await browser.newPage({ viewport: { width: 1100, height: 620 } });
  await page.setContent(`<!doctype html><html><head><meta charset="utf-8"><style>${css}</style></head><body><div id="root">${r.html}</div></body></html>`);
  await page.waitForTimeout(200);
  await page.screenshot({ path: file, fullPage: true });
  await browser.close();
  return { file, notes: r.notes };
}
