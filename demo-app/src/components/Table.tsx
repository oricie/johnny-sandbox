import type { ReactNode } from "react";

export function Table({ head, children }: { head: ReactNode[]; children: ReactNode }) {
  return (
    <table className="table">
      <thead>
        <tr>{head.map((h, i) => <th key={i}>{h}</th>)}</tr>
      </thead>
      <tbody>{children}</tbody>
    </table>
  );
}
