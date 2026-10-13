import { Fragment, useState } from "react";
import type { Alert, Severity } from "../api/types";
import { Table } from "./Table";
import { Badge } from "./Badge";

const RANK: Record<Severity, number> = { critical: 0, high: 1, medium: 2, low: 3 };

export interface AlertGroup {
  fingerprint: string;
  latest: Alert;
  severity: Severity;
  alerts: Alert[];
}

function time(iso: string) {
  return new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "UTC" });
}

// Groups alerts by fingerprint. Groups are ordered by their latest occurrence and
// keep every raw alert (D-07): nothing is dropped, only collapsed.
export function groupByFingerprint(alerts: Alert[]): AlertGroup[] {
  const sorted = [...alerts].sort((x, y) => y.detectedAt.localeCompare(x.detectedAt));
  const groups = new Map<string, AlertGroup>();
  for (const al of sorted) {
    const group = groups.get(al.fingerprint);
    if (group) {
      group.alerts.push(al);
      if (RANK[al.severity] < RANK[group.severity]) group.severity = al.severity;
    } else {
      groups.set(al.fingerprint, { fingerprint: al.fingerprint, latest: al, severity: al.severity, alerts: [al] });
    }
  }
  return [...groups.values()];
}

export function AlertList({ alerts, onOpen }: { alerts: Alert[]; onOpen: (id: string) => void }) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const groups = groupByFingerprint(alerts);

  const toggle = (fingerprint: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(fingerprint)) next.delete(fingerprint);
      else next.add(fingerprint);
      return next;
    });
  };

  return (
    <Table head={["Alert", "Asset", "Source", "Severity", "Time"]}>
      {groups.map((group) => {
        const { latest } = group;
        if (group.alerts.length === 1) {
          return (
            <tr key={latest.id} onClick={() => onOpen(latest.id)} style={{ cursor: "pointer" }}>
              <td>{latest.title}</td>
              <td>{latest.asset}</td>
              <td>{latest.source}</td>
              <td><Badge>{latest.severity}</Badge></td>
              <td>{time(latest.detectedAt)}</td>
            </tr>
          );
        }

        const isOpen = expanded.has(group.fingerprint);
        const count = group.alerts.length;
        return (
          <Fragment key={group.fingerprint}>
            <tr className="alert-group" onClick={() => toggle(group.fingerprint)}>
              <td>
                <button
                  type="button"
                  className="alert-group-toggle"
                  aria-expanded={isOpen}
                  aria-label={`${isOpen ? "Hide" : "Show"} ${count} alerts: ${latest.title} on ${latest.asset}`}
                  onClick={(e) => { e.stopPropagation(); toggle(group.fingerprint); }}
                >
                  {isOpen ? "▾" : "▸"}
                </button>
                {latest.title}
                <span className="alert-count">×{count}</span>
              </td>
              <td>{latest.asset}</td>
              <td>{latest.source}</td>
              <td><Badge>{group.severity}</Badge></td>
              <td>{time(latest.detectedAt)}</td>
            </tr>
            {isOpen && group.alerts.map((al) => (
              <tr key={al.id} className="alert-child" onClick={() => onOpen(al.id)} style={{ cursor: "pointer" }}>
                <td><span className="alert-id">{al.id}</span>{al.title}</td>
                <td>{al.asset}</td>
                <td>{al.source}</td>
                <td><Badge>{al.severity}</Badge></td>
                <td>{time(al.detectedAt)}</td>
              </tr>
            ))}
          </Fragment>
        );
      })}
    </Table>
  );
}
