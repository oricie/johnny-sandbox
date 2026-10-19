import fs from "node:fs";
import path from "node:path";
import { ROOT } from "../paths";
import { structured } from "../llm";
import { loadSources, type SourceDoc } from "./sources";
import { buildCodeGraph } from "../observe/codeGraph";

// Johnny's learning: sources -> atomic observations -> consolidated knowledge, with conflicts against
// the written decisions flagged for a person. Incremental: only new sources are read, and new
// observations are merged into what he already knows.

export interface Entry {
  id: string; // K-001
  type: "pain" | "request" | "decision" | "fact" | "behaviour";
  title: string;
  statement: string;
  screens: string[]; // routes it concerns, e.g. /alerts
  evidence: { source: string; quote: string; who: string; date: string }[];
  accounts: string[];
  strength: "single" | "repeated" | "widespread";
  first_seen: string;
  last_seen: string;
}
export interface Conflict { id: string; decision: string; entry: string; summary: string; question: string; status: "open" | "resolved" }
export interface Knowledge { updated: string; processed: string[]; entries: Entry[]; conflicts: Conflict[] }

export const KNOWLEDGE_FILE = path.join(ROOT, "knowledge", "learned.json");

export function loadLearned(): Knowledge {
  try { return JSON.parse(fs.readFileSync(KNOWLEDGE_FILE, "utf8")); }
  catch { return { updated: "", processed: [], entries: [], conflicts: [] }; }
}

interface Observation { type: Entry["type"]; statement: string; quote: string; who: string; account: string; screen: string }

const extractPrompt = (routes: string[]) => `Read one source (a customer call, support tickets, a research session or a team chat) about the
product and pull out atomic observations that matter for the product's design: pains, requests,
decisions the team made, facts about how users work, and observed behaviour.
- One observation per point. "statement" is your neutral summary; "quote" is the exact words from the source.
- "who" is the speaker with role and company if known. "account" is the customer company or "internal".
- "screen" is the product route it concerns (${routes.join(", ")}) or "" if none.
- Skip small talk and anything not about the product. Do not infer beyond what was said.`;

async function extract(doc: SourceDoc, routes: string[]): Promise<Observation[]> {
  const r = await structured<{ observations: Observation[] }>(extractPrompt(routes),
    `Source ${doc.id} (${doc.kind}, ${doc.date}): ${doc.title}\n\n${doc.text}`,
    { type: "object", additionalProperties: false, required: ["observations"], properties: { observations: { type: "array", items: {
      type: "object", additionalProperties: false, required: ["type", "statement", "quote", "who", "account", "screen"],
      properties: { type: { type: "string", enum: ["pain", "request", "decision", "fact", "behaviour"] },
        statement: { type: "string" }, quote: { type: "string" }, who: { type: "string" }, account: { type: "string" }, screen: { type: "string" } },
    } } } }, "low");
  return r.observations;
}

const CONSOLIDATE = `You maintain the product team's learned knowledge. Merge new observations into the existing
entries: add evidence to an entry when an observation says the same thing (even in different words),
otherwise create a new entry. Keep entry ids stable; new ids continue the K-### sequence.
- strength: "single" (one source), "repeated" (2+ sources or accounts), "widespread" (3+ accounts or sources of different kinds).
- Keep every piece of evidence with its source id, exact quote, who and date.
- Compare against the written product decisions. If something people said or decided contradicts a
  written decision, or suggests it changed without the decision log being updated, add a conflict:
  which decision, which entry, what disagrees, and the question a person must answer. Never resolve a
  conflict yourself; keep existing conflicts as they are.
Write titles and statements in English.`;

export async function learn(onProgress?: (s: string) => void): Promise<{ knowledge: Knowledge; newSources: number; newEntries: number; newConflicts: number }> {
  const known = loadLearned();
  const fresh = loadSources().filter((d) => !known.processed.includes(d.id));
  if (!fresh.length) return { knowledge: known, newSources: 0, newEntries: 0, newConflicts: 0 };
  onProgress?.(`Reading ${fresh.length} new source(s)…`);

  const routes = buildCodeGraph().routes.map((r) => r.path);
  const observed = (await Promise.all(fresh.map(async (d) => (await extract(d, routes)).map((o) => ({ ...o, source: d.id, date: d.date })))))
    .flat();
  onProgress?.(`${observed.length} observations. Consolidating…`);

  const decisions = fs.readFileSync(path.join(ROOT, "context/decisions.md"), "utf8");
  const merged = await structured<{ entries: Entry[]; conflicts: Conflict[] }>(CONSOLIDATE,
    `Written decisions:\n${decisions}\n\nExisting entries:\n${JSON.stringify(known.entries, null, 1)}\n\n` +
    `Existing conflicts:\n${JSON.stringify(known.conflicts, null, 1)}\n\nNew observations:\n${JSON.stringify(observed, null, 1)}`,
    { type: "object", additionalProperties: false, required: ["entries", "conflicts"], properties: {
      entries: { type: "array", items: { type: "object", additionalProperties: false,
        required: ["id", "type", "title", "statement", "screens", "evidence", "accounts", "strength", "first_seen", "last_seen"],
        properties: {
          id: { type: "string" }, type: { type: "string", enum: ["pain", "request", "decision", "fact", "behaviour"] },
          title: { type: "string" }, statement: { type: "string" }, screens: { type: "array", items: { type: "string" } },
          evidence: { type: "array", items: { type: "object", additionalProperties: false, required: ["source", "quote", "who", "date"],
            properties: { source: { type: "string" }, quote: { type: "string" }, who: { type: "string" }, date: { type: "string" } } } },
          accounts: { type: "array", items: { type: "string" } },
          strength: { type: "string", enum: ["single", "repeated", "widespread"] },
          first_seen: { type: "string" }, last_seen: { type: "string" },
        } } },
      conflicts: { type: "array", items: { type: "object", additionalProperties: false, required: ["id", "decision", "entry", "summary", "question", "status"],
        properties: { id: { type: "string" }, decision: { type: "string" }, entry: { type: "string" }, summary: { type: "string" },
          question: { type: "string" }, status: { type: "string", enum: ["open", "resolved"] } } } },
    } }, "medium");

  const knowledge: Knowledge = { updated: new Date().toISOString(), processed: [...known.processed, ...fresh.map((d) => d.id)], ...merged };
  fs.mkdirSync(path.dirname(KNOWLEDGE_FILE), { recursive: true });
  fs.writeFileSync(KNOWLEDGE_FILE, JSON.stringify(knowledge, null, 2));
  return { knowledge, newSources: fresh.length,
    newEntries: knowledge.entries.length - known.entries.length,
    newConflicts: knowledge.conflicts.filter((c) => !known.conflicts.some((k) => k.id === c.id)).length };
}
