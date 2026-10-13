import { useEffect, useState } from "react";
import { getAlerts } from "../api/client";
import type { Alert } from "../api/types";
import { PageHeader } from "../components/PageHeader";
import { AlertList } from "../components/AlertList";

export function AlertQueue() {
  const [alerts, setAlerts] = useState<Alert[]>([]);
  useEffect(() => { getAlerts().then(setAlerts); }, []);

  return (
    <>
      <PageHeader title="Alert queue" subtitle={`${alerts.length} new alerts`} />
      <AlertList alerts={alerts} onOpen={(id) => { window.location.hash = `/incident?alert=${id}`; }} />
    </>
  );
}
