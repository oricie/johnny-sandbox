import { useEffect, useState } from "react";
import { getScenarios } from "../api/client";
import type { Scenario } from "../api/types";
import { PageHeader } from "../components/PageHeader";
import { ScenarioTabs } from "../components/ScenarioTabs";
import { ScenarioDiff } from "../components/ScenarioDiff";

export function ScenarioComparison() {
  const [scenarios, setScenarios] = useState<Scenario[]>([]);
  const [activeId, setActiveId] = useState("growth");
  useEffect(() => { getScenarios().then(setScenarios); }, []);

  const baseline = scenarios.find((s) => s.id === "base");
  const active = scenarios.find((s) => s.id === activeId);
  if (!baseline || !active) return null;

  return (
    <>
      <PageHeader title="Compare scenarios" subtitle="Against FY27 Base" />
      <ScenarioTabs scenarios={scenarios} activeId={activeId} onSelect={setActiveId} />
      <ScenarioDiff scenario={active} baseline={baseline} />
    </>
  );
}
