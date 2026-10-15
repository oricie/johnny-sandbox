import fs from "node:fs";
import type { Decision } from "../decide/decide";

export interface OptionResult {
  option: string;
  branch: string;
  ok: boolean;
  sha?: string;
  summary: string;
  checks: string;
  files?: string[];
  deviations?: string[]; // changed files that were not in the option's plan
  shot?: string; // png path
  preview?: string; // live URL of this option's build
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
const img = (file?: string) =>
  file && fs.existsSync(file) ? `data:image/png;base64,${fs.readFileSync(file).toString("base64")}` : "";

// A self-contained page that looks like the Slack thread Johnny would post.
// Buttons only change the page; nothing is sent anywhere.
export function buildThreadPage(d: Decision, results: OptionResult[], beforeShot: string, citations: { total: number; valid: number }) {
  const chosen = d.findings.find((f) => f.title === d.chosen_finding) ?? d.findings[0];
  const skipped = d.findings.filter((f) => f.action === "do_not_change");
  const later = d.findings.filter((f) => f.action === "later");

  const option = (o: Decision["options"][number]) => {
    const r = results.find((x) => x.option === o.id);
    const rec = d.recommendation.option === o.id;
    return `
    <div class="card${rec ? " rec" : ""}">
      <div class="card-head"><b>Option ${o.id} · ${esc(o.name)}</b>${rec ? '<span class="tag">Recommended</span>' : ""}<span class="risk">${o.risk} risk</span></div>
      ${r?.shot ? `<img src="${img(r.shot)}" alt="Option ${o.id} screenshot">` : ""}
      ${r?.preview ? `<p><a href="${esc(r.preview)}" target="_blank" rel="noopener">▶ Open option ${o.id} live</a></p>` : ""}
      <p>${esc(o.approach)}</p>
      <ul class="pc">${o.pros.map((p) => `<li class="pro">${esc(p)}</li>`).join("")}${o.cons.map((c) => `<li class="con">${esc(c)}</li>`).join("")}</ul>
      <div class="meta">${r ? (r.ok
        ? `✅ ${esc(r.checks)} · branch <code>${esc(r.branch)}</code> @ <code>${r.sha}</code> · ${(r.files ?? []).map((f) => `<code>${esc(f.replace("demo-app/src/", ""))}</code>`).join(" ")}`
        : `❌ Checks failed, not committed<pre>${esc(r.checks)}</pre>`) : "Not implemented"}</div>
      ${r?.deviations?.length ? `<div class="box">⚠️ Outside the plan: ${r.deviations.map((f) => `<code>${esc(f.replace("demo-app/src/", ""))}</code>`).join(" ")}</div>` : ""}
    </div>`;
  };

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Johnny Thread</title>
<style>
:root{--bg:#fff;--fg:#1d1c1d;--muted:#616061;--line:#e8e8e8;--card:#f8f8f8;--accent:#007a5a;--link:#1264a3;--rec:#e8f5ef;--warn:#fff4e5}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){--bg:#1a1d21;--fg:#d1d2d3;--muted:#9a9b9e;--line:#35373b;--card:#222529;--accent:#2bac76;--link:#5aa8e8;--rec:#1c2e26;--warn:#33291b}}
:root[data-theme="dark"]{--bg:#1a1d21;--fg:#d1d2d3;--muted:#9a9b9e;--line:#35373b;--card:#222529;--accent:#2bac76;--link:#5aa8e8;--rec:#1c2e26;--warn:#33291b}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.5 -apple-system,"Segoe UI",Roboto,sans-serif}
.top{border-bottom:1px solid var(--line);padding:12px 16px;font-weight:700}.top span{color:var(--muted);font-weight:400;font-size:13px;margin-left:8px}
.wrap{max-width:860px;margin:0 auto;padding:16px}
.msg{display:flex;gap:10px;padding:10px 0}.av{width:36px;height:36px;border-radius:6px;flex:none;display:grid;place-items:center;font-weight:700;color:#fff}
.who{font-weight:700}.who small{color:var(--muted);font-weight:400;margin-left:6px}.app{font-size:11px;background:var(--card);border:1px solid var(--line);padding:0 4px;border-radius:3px;margin-left:4px;color:var(--muted)}
h3{margin:4px 0}ul{margin:6px 0;padding-left:18px}code{font-size:12px;background:var(--card);border:1px solid var(--line);padding:0 4px;border-radius:3px}
.src{color:var(--muted);font-size:12px}.box{background:var(--warn);border-radius:6px;padding:8px 12px;margin:8px 0}
.grid{display:grid;gap:12px;margin-top:10px}.card{border:1px solid var(--line);border-radius:8px;padding:12px;background:var(--card)}.card.rec{background:var(--rec);border-color:var(--accent)}
.card img{width:100%;border:1px solid var(--line);border-radius:6px;margin:8px 0}.card-head{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
.tag{background:var(--accent);color:#fff;font-size:12px;padding:1px 8px;border-radius:10px}.risk{color:var(--muted);font-size:13px;margin-left:auto}
.pc{list-style:none;padding:0}.pro::before{content:"+ ";color:var(--accent);font-weight:700}.con::before{content:"− ";color:#c2372e;font-weight:700}
.meta{font-size:13px;color:var(--muted)}pre{white-space:pre-wrap;font-size:12px}
.btns{display:flex;gap:8px;flex-wrap:wrap;margin-top:12px}button{font:inherit;padding:6px 14px;border-radius:6px;border:1px solid var(--line);background:var(--bg);color:var(--fg);cursor:pointer}
button.primary{background:var(--accent);border-color:var(--accent);color:#fff}button:disabled{opacity:.5;cursor:default}
.note{color:var(--muted);font-size:12px;margin-top:24px;border-top:1px solid var(--line);padding-top:8px}
@media (max-width:600px){.wrap{padding:12px 16px}}
</style></head><body>
<div class="top"># product-design<span>Johnny thread · demo (no live Slack)</span></div>
<div class="wrap">
${d.request ? `<div class="msg"><div class="av" style="background:#2eb67d">O</div><div>
<div class="who">Ori</div><p>@Johnny ${esc(d.request.text)}</p></div></div>` : ""}
<div class="msg"><div class="av" style="background:#4a154b">J</div><div>
<div class="who">Johnny<span class="app">APP</span><small>${d.request ? "reply" : "proactive review"}</small></div>
${d.request ? `<div class="box"><b>${d.request.verdict === "push_back" ? "✋ I don't think we should do this as asked" : "👍 On it"}</b><p>${esc(d.request.explanation)}</p></div>` : ""}
<h3>🔎 ${esc(chosen.title)}</h3>
<p>${esc(chosen.reason)}</p>
<b>Evidence</b><ul>${chosen.evidence.slice(0, 6).map((e) => `<li>${esc(e.claim)} <span class="src">${esc(e.source)}</span></li>`).join("")}</ul>
${skipped.length ? `<div class="box"><b>🔒 Not changing</b><ul>${skipped.map((f) => `<li>${esc(f.title)}: ${esc(f.reason)}</li>`).join("")}</ul></div>` : ""}
${later.length ? `<b>Also noticed, for later</b><ul>${later.map((f) => `<li>${esc(f.title)}</li>`).join("")}</ul>` : ""}
</div></div>

<div class="msg"><div class="av" style="background:#4a154b">J</div><div style="flex:1;min-width:0">
<div class="who">Johnny<span class="app">APP</span></div>
<p>I built both options in separate branches and checked them. Here is the queue today:</p>
${beforeShot ? `<div class="card"><b>Before</b><img src="${img(beforeShot)}" alt="Before"></div>` : ""}
<div class="grid">${d.options.map(option).join("")}</div>
<p><b>Recommendation: ${d.recommendation.option}.</b> ${esc(d.recommendation.why)}</p>
<p class="src">Citations checked: ${citations.valid}/${citations.total} valid</p>
<div class="btns" id="btns">
${d.options.map((o) => `<button class="${o.id === d.recommendation.option ? "primary" : ""}" data-act="Approved option ${o.id}">Approve ${o.id}</button>`).join("")}
<button data-act="Requested changes">Request changes</button>
</div><p id="ack" class="src"></p>
</div></div>

<p class="note">Generated by Johnny from a real run. Screenshots are the actual builds of each branch. The buttons only update this page; approving does not send or merge anything.</p>
</div>
<script>
document.getElementById("btns").addEventListener("click", (e) => {
  const b = e.target.closest("button"); if (!b) return;
  document.querySelectorAll("#btns button").forEach((x) => (x.disabled = true));
  document.getElementById("ack").textContent = "✅ " + b.dataset.act + " (demo: next step would open a pull request from the branch).";
});
</script>
</body></html>`;
}
