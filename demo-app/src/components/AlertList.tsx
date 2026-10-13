import type { Alert } from "../api/types";
import { Table } from "./Table";

function time(iso: string) {
  return new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "UTC" });
}

export function AlertList({ alerts, onOpen }: { alerts: Alert[]; onOpen: (id: string) => void }) {
  const sorted = [...alerts].sort((x, y) => y.detectedAt.localeCompare(x.detectedAt));
  return (
    <Table head={["Alert", "Source", "Severity", "Time"]}>
      {sorted.map((al) => (
        <tr key={al.id} onClick={() => onOpen(al.id)} style={{ cursor: "pointer" }}>
          <td>{al.title}</td>
          <td>{al.source}</td>
          <td>{al.severity}</td>
          <td>{time(al.detectedAt)}</td>
        </tr>
      ))}
    </Table>
  );
}
