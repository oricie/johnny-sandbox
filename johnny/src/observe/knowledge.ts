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
export function loadKnowledge(): KnowledgeDoc[] {
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
