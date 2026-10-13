import type { Scenario } from "../api/types";
import { Button } from "./Button";

export function ScenarioTabs({ scenarios, activeId, onSelect }: {
  scenarios: Scenario[];
  activeId: string;
  onSelect: (id: string) => void;
}) {
  return (
    <div className="tabs" role="tablist">
      {scenarios.map((s) => (
        <Button key={s.id} role="tab" aria-pressed={s.id === activeId} onClick={() => onSelect(s.id)}>
          {s.name}
        </Button>
      ))}
    </div>
  );
}
