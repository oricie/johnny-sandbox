import type { Scenario } from "../api/types";
import { Table, formatMoney } from "./Table";

export function ScenarioDiff({ scenario }: { scenario: Scenario; baseline: Scenario }) {
  return (
    <Table head={["Line", scenario.name]}>
      {Object.entries(scenario.lines).map(([line, amount]) => (
        <tr key={line}>
          <td>{line}</td>
          <td>{formatMoney(amount)}</td>
        </tr>
      ))}
    </Table>
  );
}
