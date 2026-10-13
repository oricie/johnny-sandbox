import { useEffect, useState } from "react";
import { PostureOverview } from "./screens/PostureOverview";
import { AlertQueue } from "./screens/AlertQueue";
import { IncidentResponse } from "./screens/IncidentResponse";

// Route table. Johnny reads this to map analytics screens to components.
export const routes = [
  { path: "/overview", screen: PostureOverview, title: "Posture" },
  { path: "/alerts", screen: AlertQueue, title: "Alert queue" },
  { path: "/incident", screen: IncidentResponse, title: "Incident response" },
];

function currentPath() {
  return window.location.hash.replace(/^#/, "").split("?")[0] || "/overview";
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
        <strong>Sentinel</strong>
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
