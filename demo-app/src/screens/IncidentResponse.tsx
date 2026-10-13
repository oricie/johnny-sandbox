import { useEffect, useState } from "react";
import { getIncident, getPermissions, isolateHost } from "../api/client";
import type { Incident, Permissions } from "../api/types";
import { PageHeader } from "../components/PageHeader";
import { Badge } from "../components/Badge";
import { Button } from "../components/Button";

export function IncidentResponse() {
  const [incident, setIncident] = useState<Incident | null>(null);
  const [perms, setPerms] = useState<Permissions | null>(null);

  useEffect(() => {
    getIncident("INC-311").then(setIncident);
    getPermissions().then(setPerms);
  }, []);

  if (!incident || !perms) return null;

  return (
    <>
      <PageHeader title={`${incident.id} · ${incident.title}`} subtitle={`Host ${incident.host}`} />
      <p><Badge>{incident.severity}</Badge> {incident.alerts.length} linked alert(s)</p>
      <h2 style={{ fontSize: 16 }}>Containment</h2>
      <Button
        disabled={!perms.canRunContainment || incident.isolated}
        title={perms.canRunContainment ? undefined : "Requires incident lead approval"}
        onClick={() => isolateHost(incident.id).then((ok) => ok && setIncident({ ...incident, isolated: true }))}
      >
        Isolate host
      </Button>
    </>
  );
}
