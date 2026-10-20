import { useEffect, useState } from "react";
import { getAlerts, getIncident, getPermissions, isolateHost } from "../api/client";
import type { Alert, Incident, Permissions } from "../api/types";
import { PageHeader } from "../components/PageHeader";
import { Badge } from "../components/Badge";
import { Button } from "../components/Button";

function time(iso: string) {
  return new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "UTC" });
}

export function IncidentResponse() {
  const [incident, setIncident] = useState<Incident | null>(null);
  const [perms, setPerms] = useState<Permissions | null>(null);
  const [alerts, setAlerts] = useState<Alert[]>([]);

  useEffect(() => {
    getIncident("INC-311").then(setIncident);
    getPermissions().then(setPerms);
    getAlerts().then(setAlerts);
  }, []);

  if (!incident || !perms) return null;
  const linked = alerts.filter((a) => incident.alerts.includes(a.id));

  return (
    <>
      <PageHeader title={`${incident.id} · ${incident.title}`} subtitle={`Host ${incident.host}`} />
      <dl className="meta">
        <div className="card"><dt>Severity</dt><dd><Badge>{incident.severity}</Badge></dd></div>
        <div className="card"><dt>Host</dt><dd>{incident.host}</dd></div>
        <div className="card"><dt>Status</dt><dd>{incident.isolated ? "Contained" : "Investigating"}</dd></div>
        <div className="card"><dt>Linked alerts</dt><dd>{incident.alerts.length}</dd></div>
      </dl>
      <div className="grid-2">
        <div className="card">
          <h2 className="section-title">Linked alerts</h2>
          <ul className="list">
            {linked.map((a) => <li key={a.id}><span>{a.title} <span className="muted">· {a.source}</span></span><span className="when">{time(a.detectedAt)}</span></li>)}
          </ul>
        </div>
        <div className="card">
          <h2 className="section-title">Containment</h2>
          <p className="muted" style={{ margin: "0 0 12px" }}>Cut {incident.host} off the network while the investigation continues.</p>
          <Button
            disabled={!perms.canRunContainment || incident.isolated}
            title={perms.canRunContainment ? undefined : "Requires incident lead approval"}
            onClick={() => isolateHost(incident.id).then((ok) => ok && setIncident({ ...incident, isolated: true }))}
          >
            Isolate host
          </Button>
        </div>
      </div>
    </>
  );
}
