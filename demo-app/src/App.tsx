import { useEffect, useState } from "react";
import { BudgetOverview } from "./screens/BudgetOverview";
import { ScenarioEditor } from "./screens/ScenarioEditor";
import { ScenarioComparison } from "./screens/ScenarioComparison";

// Route table. Atlas reads this to map analytics screens to components.
export const routes = [
  { path: "/overview", screen: BudgetOverview, title: "Budget overview" },
  { path: "/scenarios/edit", screen: ScenarioEditor, title: "Scenario editor" },
  { path: "/compare", screen: ScenarioComparison, title: "Compare scenarios" },
];

function currentPath() {
  return window.location.hash.replace(/^#/, "") || "/overview";
}

export function App() {
  const [path, setPath] = useState(currentPath());
  useEffect(() => {
    const onHash = () => setPath(currentPath());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  const route = routes.find((r) => r.path === path) ?? routes[0];
  const Screen = route.screen;
  return (
    <div className="shell">
      <nav className="nav">
        <strong>Ledgerline</strong>
        {routes.map((r) => (
          <a key={r.path} href={`#${r.path}`} aria-current={r.path === route.path ? "page" : undefined}>
            {r.title}
          </a>
        ))}
      </nav>
      <main className="main">
        <Screen />
      </main>
    </div>
  );
}
