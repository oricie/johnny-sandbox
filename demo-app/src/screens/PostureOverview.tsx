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

  return (
    <>
      <PageHeader title="Security posture" subtitle="Last 24 hours · all sources" />
      <Table head={["Severity", "Open alerts"]}>
        {ORDER.map((sev) => (
          <tr key={sev}>
            <td><Badge>{sev}</Badge></td>
            <td>{alerts.filter((a) => a.severity === sev && a.status !== "closed").length}</td>
          </tr>
        ))}
      </Table>
    </>
  );
}
