import { spawn, spawnSync } from "node:child_process";
import path from "node:path";
import { launchBrowser } from "../browser";
import { ROOT } from "../paths";

const VITE = path.join(ROOT, "node_modules/.bin/vite");

async function waitFor(url: string, ms = 20000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    try { if ((await fetch(url)).ok) return; } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`Timed out waiting for ${url}`);
}

// Builds a checkout's demo-app once, serves the build, and screenshots several routes.
export async function screenshotMany(dir: string, shots: { route: string; file: string }[], port: number) {
  const app = path.join(dir, "demo-app");
  const build = spawnSync(VITE, ["build", "--logLevel", "error"], { cwd: app, encoding: "utf8" });
  if (build.status !== 0) throw new Error(`build failed in ${dir}:\n${build.stderr}`);
  const server = spawn(VITE, ["preview", "--port", String(port), "--strictPort"], { cwd: app, stdio: "ignore" });
  try {
    await waitFor(`http://localhost:${port}/`);
    const browser = await launchBrowser();
    const page = await browser.newPage({ viewport: { width: 1100, height: 720 } });
    for (const s of shots) {
      await page.goto(`http://localhost:${port}/#${s.route}`);
      await page.waitForTimeout(800);
      await page.screenshot({ path: s.file, fullPage: true });
    }
    await browser.close();
  } finally {
    server.kill();
  }
}

// Builds a checkout's demo-app, serves the build, and screenshots one route.
// The API is not started: the app falls back to its seed data, so every shot uses the same data.
export async function screenshot(dir: string, route: string, file: string, port: number) {
  const app = path.join(dir, "demo-app");
  const build = spawnSync(VITE, ["build", "--logLevel", "error"], { cwd: app, encoding: "utf8" });
  if (build.status !== 0) throw new Error(`build failed in ${dir}:\n${build.stderr}`);
  const server = spawn(VITE, ["preview", "--port", String(port), "--strictPort"], { cwd: app, stdio: "ignore" });
  try {
    await waitFor(`http://localhost:${port}/`);
    const browser = await launchBrowser();
    const page = await browser.newPage({ viewport: { width: 1100, height: 620 } });
    await page.goto(`http://localhost:${port}/#${route}`);
    await page.waitForTimeout(800);
    await page.screenshot({ path: file });
    await browser.close();
  } finally {
    server.kill();
  }
}
