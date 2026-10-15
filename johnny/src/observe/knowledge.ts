import fs from "node:fs";
import path from "node:path";
import { ROOT } from "../paths";
import type { KnowledgeDoc } from "../types";

const CONTEXT = path.join(ROOT, "context");

function parseScope(raw: string | undefined): string[] {
  if (!raw) return [];
  try { return JSON.parse(raw); } catch { return []; }
}

// Markdown files with frontmatter. decisions.md is split into one doc per "## D-xx" section,
// each with its own `scope:` line, so a rule is attached to exactly the files it governs.
// What Johnny learned from calls, tickets, research and Slack (knowledge/learned.json), as docs
// scoped to the screens they concern. Open conflicts with written decisions are included too.
function learnedDocs(): KnowledgeDoc[] {
  const file = path.join(ROOT, "knowledge", "learned.json");
  if (!fs.existsSync(file)) return [];
  const k = JSON.parse(fs.readFileSync(file, "utf8"));
  const app = fs.readFileSync(path.join(ROOT, "demo-app/src/App.tsx"), "utf8");
  // Route -> screen file, from the route table and its imports.
  const screenFile = (route: string) => {
    const screen = new RegExp(`path:\\s*"${route.replace(/[/]/g, "\\/")}",\\s*screen:\\s*(\\w+)`).exec(app)?.[1];
    const from = screen && new RegExp(`import \\{ ${screen} \\} from "\\./(.+?)"`).exec(app)?.[1];
    return from ? [`demo-app/src/${from}.tsx`] : [];
  };
  const entries = (k.entries ?? []).map((e: any): KnowledgeDoc => ({
    id: `learned#${e.id}`, type: `learned-${e.type}`, title: `${e.title} (${e.strength}, ${e.evidence.length} sources)`,
    scope: e.screens.flatMap(screenFile).concat(e.screens.length ? [] : ["demo-app/**"]),
    body: `${e.statement}\nAccounts: ${e.accounts.join(", ") || "-"}. Seen ${e.first_seen} to ${e.last_seen}.\n` +
      e.evidence.map((v: any) => `- "${v.quote}" (${v.who}, ${v.source}, ${v.date})`).join("\n"),
  }));
  const conflicts = (k.conflicts ?? []).filter((c: any) => c.status === "open").map((c: any): KnowledgeDoc => {
    const entry = (k.entries ?? []).find((e: any) => e.id === c.entry);
    return { id: `learned#${c.id}`, type: "conflict", title: `OPEN CONFLICT: ${c.decision} vs ${c.entry}`,
      scope: (entry?.screens ?? []).flatMap(screenFile), body: `${c.summary}\nUnanswered question: ${c.question}` };
  });
  return [...entries, ...conflicts];
}

export function loadKnowledge(): KnowledgeDoc[] {
  return [...writtenKnowledge(), ...learnedDocs()];
}

function writtenKnowledge(): KnowledgeDoc[] {
  const docs: KnowledgeDoc[] = [];
  for (const name of fs.readdirSync(CONTEXT).filter((f) => f.endsWith(".md"))) {
    const text = fs.readFileSync(path.join(CONTEXT, name), "utf8");
    const fm = /^---\n([\s\S]*?)\n---\n/.exec(text);
    const meta = Object.fromEntries((fm?.[1] ?? "").split("\n").map((l) => {
      const i = l.indexOf(":");
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    }));
    const body = fm ? text.slice(fm[0].length) : text;

    if (meta.type === "decision") {
      for (const section of body.split(/^## /m).slice(1)) {
        const title = section.split("\n")[0].trim();
        const id = title.split(" ")[0];
        const status = /^status:\s*(\w+)/m.exec(section)?.[1];
        if (status !== "active") continue;
        docs.push({
          id: `decisions.md#${id}`,
          type: "decision",
          title,
          scope: parseScope(/^scope:\s*(.+)$/m.exec(section)?.[1]),
          body: section.replace(/^(status|scope):.*$/gm, "").trim(),
        });
      }
    } else {
      docs.push({
        id: name,
        type: meta.type ?? "doc",
        title: /^# (.+)$/m.exec(body)?.[1] ?? name,
        scope: parseScope(meta.scope),
        body: body.trim(),
      });
    }
  }
  return docs;
}
