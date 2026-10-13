import fs from "node:fs";
import path from "node:path";
import { ROOT } from "../paths";
import type { Signal } from "../types";

interface Analytics {
  screens: Record<string, {
    sessions: number; median_time_s: number; exit_rate: number;
    events?: Record<string, Record<string, unknown>>;
    by_role?: Record<string, unknown>;
  }>;
  feedback: { screen: string; role: string; text: string }[];
}

// Flattens analytics.json into uniform signals tied to a route.
export function loadSignals(): Signal[] {
  const a: Analytics = JSON.parse(fs.readFileSync(path.join(ROOT, "context/analytics.json"), "utf8"));
  const signals: Signal[] = [];
  for (const [screen, s] of Object.entries(a.screens)) {
    const src = `analytics.json#screens["${screen}"]`;
    signals.push({ id: `${screen}:exit_rate`, screen, metric: "exit_rate", value: s.exit_rate, source: src });
    signals.push({ id: `${screen}:median_time_s`, screen, metric: "median_time_s", value: s.median_time_s, source: src });
    for (const [event, detail] of Object.entries(s.events ?? {})) {
      signals.push({ id: `${screen}:${event}`, screen, metric: event, value: (detail.count ?? detail.rate) as number, detail, source: `${src}.events.${event}` });
    }
    if (s.by_role) signals.push({ id: `${screen}:by_role`, screen, metric: "by_role", value: "see detail", detail: s.by_role, source: `${src}.by_role` });
  }
  a.feedback.forEach((f, i) =>
    signals.push({ id: `${f.screen}:feedback:${i}`, screen: f.screen, metric: "feedback", value: f.text, detail: { role: f.role }, source: `analytics.json#feedback[${i}]` }),
  );
  return signals;
}
