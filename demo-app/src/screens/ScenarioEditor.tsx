import { useEffect, useState } from "react";
import { getPermissions, getScenarios, updateLine } from "../api/client";
import type { Permissions, Scenario } from "../api/types";
import { PageHeader } from "../components/PageHeader";
import { ScenarioTabs } from "../components/ScenarioTabs";
import { Table, formatMoney } from "../components/Table";

export function ScenarioEditor() {
  const [scenarios, setScenarios] = useState<Scenario[]>([]);
  const [perms, setPerms] = useState<Permissions | null>(null);
  const [activeId, setActiveId] = useState("growth");

  useEffect(() => {
    getScenarios().then(setScenarios);
    getPermissions().then(setPerms);
  }, []);

  const active = scenarios.find((s) => s.id === activeId);
  if (!active || !perms) return null;

  const locked = active.status === "approved" && !perms.canEditApproved;

  return (
    <>
      <PageHeader title="Scenario editor" subtitle={`Editing ${active.name}`} />
      <ScenarioTabs scenarios={scenarios} activeId={activeId} onSelect={setActiveId} />
      <Table head={["Line", "Amount"]}>
        {Object.entries(active.lines).map(([line, amount]) => (
          <tr key={line}>
            <td>{line}</td>
            <td className={locked ? "cell-locked" : undefined}>
              {locked ? (
                formatMoney(amount)
              ) : (
                <input
                  defaultValue={amount}
                  onBlur={(e) => updateLine(active.id, line, Number(e.target.value))}
                />
              )}
            </td>
          </tr>
        ))}
      </Table>
    </>
  );
}
