import type { Alert, Severity } from "../api/types";
import { Table } from "./Table";
import { Badge } from "./Badge";

const SEVERITY_RANK: Record<Severity, number> = { critical: 0, high: 1, medium: 2, low: 3 };

const CRITICALITY_RANK: Record<Alert["assetCriticality"], number> = {
  "crown-jewel": 0,
  production: 1,
  internal: 2,
  test: 3,
};

function time(iso: string) {
  return new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "UTC" });
}

// Risk order: severity, then what the asset is, then newest first.
// Only the order changes; every alert stays in the list (D-07).
function byRisk(x: Alert, y: Alert) {
  return (
    SEVERITY_RANK[x.severity] - SEVERITY_RANK[y.severity] ||
    CRITICALITY_RANK[x.assetCriticality] - CRITICALITY_RANK[y.assetCriticality] ||
    y.detectedAt.localeCompare(x.detectedAt)
  );
}

export function AlertList({ alerts, onOpen }: { alerts: Alert[]; onOpen: (id: string) => void }) {
  const sorted = [...alerts].sort(byRisk);
  return (
    <Table head={["Alert", "Asset", "Source", "Severity", "Time"]}>
      {sorted.map((al) => (
        <tr key={al.id} onClick={() => onOpen(al.id)} style={{ cursor: "pointer" }}>
          <td>{al.title}</td>
          <td>
            {al.asset} <Badge>{al.assetCriticality}</Badge>
          </td>
          <td>{al.source}</td>
          <td><Badge severity={al.severity}>{al.severity}</Badge></td>
          <td>{time(al.detectedAt)}</td>
        </tr>
      ))}
    </Table>
  );
}
