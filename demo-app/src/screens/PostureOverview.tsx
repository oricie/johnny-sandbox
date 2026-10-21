import { useEffect, useState } from "react";
import { getAlerts } from "../api/client";
import type { Alert, Severity } from "../api/types";
import { PageHeader } from "../components/PageHeader";
import { Badge } from "../components/Badge";
import { Table } from "../components/Table";

const ORDER: Severity[] = ["critical", "high", "medium", "low"];

// Not available from the API yet: same static values the screen showed before.
const TRIAGE_MEDIAN = "21m";
const TRIAGE_GOAL = "5m";
const ASSETS_MONITORED = "1,284";
const SENSORS_OFFLINE = 3;

function plural(n: number, one: string, many: string) {
  return n === 1 ? one : many;
}

function headline(crownCriticals: number, criticals: number) {
  const triage = `Critical triage takes ${TRIAGE_MEDIAN} against a ${TRIAGE_GOAL} goal.`;
  if (crownCriticals > 0) {
    return `${crownCriticals} critical ${plural(crownCriticals, "alert", "alerts")} open on ${plural(crownCriticals, "a crown-jewel asset", "crown-jewel assets")}. ${triage}`;
  }
  if (criticals > 0) {
    return `No criticals on crown-jewel assets; ${criticals} open elsewhere. ${triage}`;
  }
  return `No critical alerts open. ${triage}`;
}

export function PostureOverview() {
  const [alerts, setAlerts] = useState<Alert[] | null>(null);
  useEffect(() => { getAlerts().then(setAlerts); }, []);

  if (!alerts) {
    return (
      <div className="overview">
        <PageHeader title="Security posture" subtitle="Last 24 hours · all sources" />
        <p className="posture-loading">Loading posture…</p>
      </div>
    );
  }

  const open = alerts.filter((a) => a.status !== "closed");
  const criticals = open.filter((a) => a.severity === "critical");
  const crownCriticals = criticals.filter((a) => a.assetCriticality === "crown-jewel").length;
  const sources = new Set(open.map((a) => a.source)).size;
  const noisy = Object.entries(open.reduce<Record<string, number>>((n, a) => ({ ...n, [a.title]: (n[a.title] ?? 0) + 1 }), {}))
    .sort((a, b) => b[1] - a[1]).slice(0, 4);

  return (
    <div className="overview">
      <PageHeader title="Security posture" subtitle="Last 24 hours · all sources" />
      <section className="posture" aria-label="Posture summary">
        <p className="posture-headline">{headline(crownCriticals, criticals.length)}</p>
        <dl className="figures">
          <div className="figure">
            <dt className="figure-label">Open criticals on crown-jewel assets</dt>
            <dd className="figure-value">{crownCriticals}</dd>
            <dd className="figure-note">{criticals.length} critical open in total</dd>
          </div>
          <div className="figure figure-primary">
            <dt className="figure-label">Time to triage, criticals</dt>
            <dd className="figure-value">{TRIAGE_MEDIAN}</dd>
            <dd className="figure-note">median · goal {TRIAGE_GOAL}</dd>
          </div>
          <div className="figure">
            <dt className="figure-label">Open alerts</dt>
            <dd className="figure-value">{open.length}</dd>
            <dd className="figure-note">across {sources} {plural(sources, "source", "sources")}</dd>
          </div>
        </dl>
        <p className="posture-support">
          {ASSETS_MONITORED} assets monitored · {SENSORS_OFFLINE} sensors offline this week
        </p>
      </section>
      <div className="grid-2">
        <section>
          <h2 className="type-heading">Open alerts by severity</h2>
          <Table head={["Severity", "Open alerts"]}>
            {ORDER.map((sev) => (
              <tr key={sev}>
                <td><Badge severity={sev}>{sev}</Badge></td>
                <td>{open.filter((a) => a.severity === sev).length}</td>
              </tr>
            ))}
          </Table>
        </section>
        <section>
          <h2 className="type-heading">Noisiest detections</h2>
          <Table head={["Detection", "Open alerts"]}>
            {noisy.length === 0 ? (
              <tr><td colSpan={2} className="muted">No open alerts in the last 24 hours</td></tr>
            ) : (
              noisy.map(([title, n]) => (
                <tr key={title}>
                  <td>{title}</td>
                  <td>{n}</td>
                </tr>
              ))
            )}
          </Table>
        </section>
      </div>
    </div>
  );
}
