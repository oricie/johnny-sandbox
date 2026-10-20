import { useEffect, useState } from "react";
import { getAlerts } from "../api/client";
import type { Alert, Severity } from "../api/types";
import { PageHeader } from "../components/PageHeader";
import { Badge } from "../components/Badge";
import { Table } from "../components/Table";

const ORDER: Severity[] = ["critical", "high", "medium", "low"];

export function PostureOverview() {
  const [alerts, setAlerts] = useState<Alert[]>([]);
  useEffect(() => { getAlerts().then(setAlerts); }, []);

  const open = alerts.filter((a) => a.status !== "closed");
  const noisy = Object.entries(open.reduce<Record<string, number>>((n, a) => ({ ...n, [a.title]: (n[a.title] ?? 0) + 1 }), {}))
    .sort((a, b) => b[1] - a[1]).slice(0, 4);

  return (
    <>
      <PageHeader title="Security posture" subtitle="Last 24 hours · all sources" />
      <div className="kpis">
        <div className="card"><div className="kpi-label">Open alerts</div><div className="kpi-value">{open.length}</div><div className="kpi-note">across 4 sources</div></div>
        <div className="card"><div className="kpi-label">Open criticals</div><div className="kpi-value">{open.filter((a) => a.severity === "critical").length}</div><div className="kpi-note">on crown-jewel assets</div></div>
        <div className="card"><div className="kpi-label">Time to triage, criticals</div><div className="kpi-value">21m</div><div className="kpi-note">median · goal 5m</div></div>
        <div className="card"><div className="kpi-label">Assets monitored</div><div className="kpi-value">1,284</div><div className="kpi-note">3 sensors offline this week</div></div>
      </div>
      <div className="grid-2">
        <div>
          <h2 className="section-title">Open alerts by severity</h2>
          <Table head={["Severity", "Open alerts"]}>
            {ORDER.map((sev) => (
              <tr key={sev}>
                <td><Badge>{sev}</Badge></td>
                <td>{open.filter((a) => a.severity === sev).length}</td>
              </tr>
            ))}
          </Table>
        </div>
        <div className="card">
          <h2 className="section-title">Noisiest detections</h2>
          <ul className="list">
            {noisy.map(([title, n]) => <li key={title}><span>{title}</span><span className="when">{n}×</span></li>)}
          </ul>
        </div>
      </div>
    </>
  );
}
