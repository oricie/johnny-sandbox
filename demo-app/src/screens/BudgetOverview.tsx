import { useEffect, useState } from "react";
import { getScenarios } from "../api/client";
import type { Scenario } from "../api/types";
import { PageHeader } from "../components/PageHeader";
import { Badge } from "../components/Badge";
import { Table, formatMoney } from "../components/Table";

export function BudgetOverview() {
  const [scenarios, setScenarios] = useState<Scenario[]>([]);
  useEffect(() => { getScenarios().then(setScenarios); }, []);

  return (
    <>
      <PageHeader title="Budget overview" subtitle="FY27 planning cycle · all scenarios" />
      <Table head={["Scenario", "Status", "Total"]}>
        {scenarios.map((s) => (
          <tr key={s.id}>
            <td>{s.name}</td>
            <td><Badge>{s.status}</Badge></td>
            <td>{formatMoney(Object.values(s.lines).reduce((a, b) => a + b, 0))}</td>
          </tr>
        ))}
      </Table>
    </>
  );
}
