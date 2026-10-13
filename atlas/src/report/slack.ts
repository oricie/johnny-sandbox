import type { Decision } from "../decide/decide";

type Block = Record<string, unknown>;

const md = (text: string): Block => ({ type: "section", text: { type: "mrkdwn", text } });

// Block Kit payload for the thread. Posting it is a separate step (slack/ app),
// so the same payload can be previewed offline in Block Kit Builder.
export function buildSlackMessage(d: Decision, opts: { citations: { total: number; invalid: unknown[] } }): Block[] {
  const chosen = d.findings.find((f) => f.title === d.chosen_finding) ?? d.findings[0];
  const skipped = d.findings.filter((f) => f.action === "do_not_change");

  const blocks: Block[] = [
    { type: "header", text: { type: "plain_text", text: `🔎 ${chosen.title}` } },
    md(`${chosen.reason}\n\n*Evidence*\n${chosen.evidence.map((e) => `• ${e.claim} — \`${e.source}\``).join("\n")}`),
  ];

  if (skipped.length) {
    blocks.push(md(`*🔒 Not changing*\n${skipped.map((f) => `• ${f.title}: ${f.reason}`).join("\n")}`));
  }

  blocks.push({ type: "divider" });
  for (const o of d.options) {
    blocks.push(md(
      `*${o.id} · ${o.name}*  — ${o.files_to_change.length} files, ${o.risk} risk\n${o.approach}\n` +
      o.pros.map((p) => `+ ${p}`).join("\n") + "\n" + o.cons.map((c) => `− ${c}`).join("\n"),
    ));
  }

  blocks.push(md(`*Recommendation: ${d.recommendation.option}.* ${d.recommendation.why}`));
  blocks.push({
    type: "context",
    elements: [{ type: "mrkdwn", text: `Citations checked: ${opts.citations.total - opts.citations.invalid.length}/${opts.citations.total} valid` }],
  });
  blocks.push({
    type: "actions",
    elements: [
      { type: "button", action_id: "approve_a", text: { type: "plain_text", text: "Approve A" }, value: "A" },
      { type: "button", action_id: "approve_b", text: { type: "plain_text", text: "Approve B" }, value: "B", style: "primary" },
      { type: "button", action_id: "revise", text: { type: "plain_text", text: "Request changes" } },
    ],
  });
  return blocks;
}
