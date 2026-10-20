import { spawn } from "node:child_process";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { launchBrowser } from "../browser";
import { ROOT } from "../paths";

// Records site/video/film.html to an mp4: render(t) for each frame, screenshots piped into ffmpeg.
//   tsx src/demo/film.ts [--preview <seconds,...>]  (preview writes stills instead of a video)
const FPS = 30;
const page = await (await launchBrowser()).newPage({ viewport: { width: 1920, height: 1080 } });
await page.goto(pathToFileURL(path.join(ROOT, "site/video/film.html")).href, { waitUntil: "networkidle" });
await page.evaluate(() => document.fonts.ready);
const previewArg = process.argv.indexOf("--preview");
if (previewArg >= 0) {
  for (const s of process.argv[previewArg + 1].split(",").map(Number)) {
    // Render the frames before it so eased values (scrolling) settle the way they would in the video.
    for (let f = Math.max(0, Math.round((s - 3) * FPS)); f <= Math.round(s * FPS); f++) await page.evaluate((t) => (window as any).render(t), f / FPS);
    await page.screenshot({ path: path.join(ROOT, "out", `film-${s}.png`) });
  }
  process.exit(0);
}
const duration: number = await page.evaluate(() => (window as any).DURATION);
const out = path.join(ROOT, "out", "johnny-film.mp4");
const ff = spawn("ffmpeg", ["-y", "-loglevel", "error", "-f", "image2pipe", "-framerate", String(FPS), "-i", "-",
  "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "20", "-preset", "medium", "-movflags", "+faststart", out], { stdio: ["pipe", "inherit", "inherit"] });
const frames = duration * FPS;
for (let f = 0; f < frames; f++) {
  await page.evaluate((t) => (window as any).render(t), f / FPS);
  const buf = await page.screenshot({ type: "jpeg", quality: 92 });
  if (!ff.stdin.write(buf)) await new Promise((r) => ff.stdin.once("drain", r));
  if (f % (FPS * 10) === 0) console.log(`${(f / FPS).toFixed(0)}s / ${duration}s`);
}
ff.stdin.end();
await new Promise((r) => ff.on("close", r));
console.log(`video: ${out}`);
process.exit(0);
