import { useEffect, useState } from "react";
import { getAlerts } from "../api/client";
import type { Alert } from "../api/types";
import { PageHeader } from "../components/PageHeader";
import { AlertList, groupByFingerprint } from "../components/AlertList";

function plural(n: number, word: string) {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

export function AlertQueue() {
  const [alerts, setAlerts] = useState<Alert[]>([]);
  useEffect(() => { getAlerts().then(setAlerts); }, []);

  const groupCount = groupByFingerprint(alerts).length;

  return (
    <>
      <PageHeader title="Alert queue" subtitle={`${plural(alerts.length, "alert")} · ${plural(groupCount, "group")}`} />
      <AlertList alerts={alerts} onOpen={(id) => { window.location.hash = `/incident?alert=${id}`; }} />
    </>
  );
}
