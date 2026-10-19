import fs from "node:fs";
import type { UrlReview } from "./review";

// One self-contained HTML page (images inlined): what Johnny walked, what he found on which screen,
// and the two sketched directions next to the screen as it is.
type Report = UrlReview & {
  url: string; seconds: number; usage: { usd: number };
  looks: { id: number; url: string; title: string }[];
  annotated: Record<number, string>;
  sketches: { files: Record<string, string>; notes: string };
};

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
const img = (file: string | undefined, alt: string) =>
  file && fs.existsSync(file) ? `<img alt="${esc(alt)}" src="data:image/png;base64,${fs.readFileSync(file).toString("base64")}">` : "";

export function reportPage(r: Report, _dir: string) {
  const host = new URL(r.url).hostname;
  const chosen = r.findings.find((f) => f.title === r.chosen);
  const byLook = [...new Set(r.findings.map((f) => f.look))];
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Johnny on ${esc(host)}</title>
<style>
:root{--bg:#fafaf9;--fg:#1c1917;--muted:#57534e;--line:#e7e5e4;--card:#fff;--accent:#d97706;--hi:#b91c1c;--md:#b45309;--lo:#57534e}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){--bg:#1c1917;--fg:#f5f5f4;--muted:#a8a29e;--line:#44403c;--card:#292524;--accent:#f59e0b;--hi:#f87171;--md:#fbbf24;--lo:#a8a29e}}
:root[data-theme="dark"]{--bg:#1c1917;--fg:#f5f5f4;--muted:#a8a29e;--line:#44403c;--card:#292524;--accent:#f59e0b;--hi:#f87171;--md:#fbbf24;--lo:#a8a29e}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.55 system-ui,-apple-system,"Segoe UI",sans-serif}
main{max-width:1080px;margin:0 auto;padding:32px 16px 64px}
h1{font-size:26px;margin:0 0 4px}h2{font-size:19px;margin:40px 0 12px}h3{font-size:16px;margin:0 0 6px}
.muted{color:var(--muted)}.card{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:16px;margin:12px 0}
img{max-width:100%;height:auto;display:block;border:1px solid var(--line);border-radius:8px}
.flow{padding-left:20px}.tag{display:inline-block;font-size:12px;font-weight:600;padding:1px 8px;border-radius:99px;border:1px solid currentColor;margin-right:6px}
.high{color:var(--hi)}.medium{color:var(--md)}.low{color:var(--lo)}
.num{display:inline-block;min-width:22px;height:22px;border-radius:11px;background:var(--accent);color:#111;font-weight:700;font-size:13px;text-align:center;line-height:22px;margin-right:6px}
.grid{display:grid;gap:16px}@media(min-width:900px){.grid.two{grid-template-columns:1fr 1fr}}
.chosen{border-color:var(--accent);border-width:2px}
</style></head><body><main>
<h1>Johnny on ${esc(host)}</h1>
<p class="muted">A first look with nothing but the link: ${r.looks.length} screens walked, ${r.findings.length} findings, ${Math.round(r.seconds / 60)} min.</p>
<div class="card">${esc(r.product_summary)}</div>

<h2>What I walked</h2>
<ol class="flow">${r.flow.map((s) => `<li>${esc(s)}</li>`).join("")}</ol>

<h2>What I'd fix now</h2>
${chosen ? `<div class="card chosen"><h3>${esc(chosen.title)}</h3><p>${esc(chosen.user_sees)}</p><p class="muted">${esc(chosen.why_it_matters)}</p></div>` : ""}
<div class="grid">
  <div><h3>Now</h3>${img(r.sketches.files.before, "The screen now")}</div>
  ${r.directions.map((d) => `<div><h3>Direction ${d.id}: ${esc(d.name)}</h3><p>${esc(d.idea)}</p><p class="muted">Gives up: ${esc(d.gives_up)}</p>${img(r.sketches.files[d.id], `Sketch of direction ${d.id}`)}</div>`).join("")}
</div>
<p class="muted">Sketches are static: the real page with one section rewritten, nothing built. ${esc(r.sketches.notes)}</p>

<h2>Everything I found</h2>
${byLook.map((id) => {
  const look = r.looks.find((l) => l.id === id);
  const items = r.findings.map((f, i) => ({ f, i })).filter(({ f }) => f.look === id);
  return `<div class="card"><p class="muted">Screen ${id}: ${esc(look?.title ?? "")} · ${esc(look?.url ?? "")}</p>${img(r.annotated[id], `Screen ${id} with findings marked`)}
  ${items.map(({ f, i }) => `<div style="margin-top:14px"><h3><span class="num">${i + 1}</span><span class="tag ${f.impact}">${f.impact}</span>${esc(f.title)}</h3>
    <p>${esc(f.user_sees)}</p><p class="muted">${esc(f.why_it_matters)}</p></div>`).join("")}</div>`;
}).join("")}
<p class="muted">Model cost for this review: $${r.usage.usd.toFixed(2)}.</p>
</main></body></html>`;
}
