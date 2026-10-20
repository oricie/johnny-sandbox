import { useEffect, useState } from "react";
import { PostureOverview } from "./screens/PostureOverview";
import { AlertQueue } from "./screens/AlertQueue";
import { IncidentResponse } from "./screens/IncidentResponse";

// Route table. Johnny reads this to map analytics screens to components.
// Exploration prototypes: every prototypes/<name>.tsx is served at #/proto/<name>, outside the nav.
const prototypeModules = import.meta.glob<{ default: () => JSX.Element }>("./prototypes/*.tsx", { eager: true });
const prototypes = Object.fromEntries(
  Object.entries(prototypeModules).map(([file, mod]) => [`/proto/${file.replace(/^.*\/(.*)\.tsx$/, "$1")}`, mod.default]),
);

export const routes = [
  { path: "/overview", screen: PostureOverview, title: "Posture" },
  { path: "/alerts", screen: AlertQueue, title: "Alert queue" },
  { path: "/incident", screen: IncidentResponse, title: "Incident response" },
];

// Nav icons (16px line icons), keyed by route.
const icons: Record<string, JSX.Element> = {
  "/overview": <path d="M3 13h4V7H3v6Zm6 0h4V3H9v10Z" />,
  "/alerts": <path d="M8 2.5a4 4 0 0 0-4 4V9l-1.2 2h10.4L12 9V6.5a4 4 0 0 0-4-4ZM6.5 13a1.5 1.5 0 0 0 3 0" />,
  "/incident": <path d="M8 2 3 4v4c0 3 2.2 5 5 6 2.8-1 5-3 5-6V4L8 2Z" />,
};
const Icon = ({ path }: { path: string }) => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" aria-hidden="true">{icons[path]}</svg>
);

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
  const Screen = prototypes[path] ?? route.screen;
  return (
    <div className="shell">
      <nav className="nav">
        <div className="brand">
          <svg width="26" height="26" viewBox="0 0 26 26" aria-hidden="true"><rect width="26" height="26" rx="7" fill="var(--color-accent)" /><path d="M13 6 7.5 8.2v4.3c0 3.3 2.4 5.5 5.5 6.6 3.1-1.1 5.5-3.3 5.5-6.6V8.2L13 6Z" fill="none" stroke="var(--color-nav-active-text)" strokeWidth="1.6" /></svg>
          <span>Sentinel<small>Northwind SOC</small></span>
        </div>
        <div className="nav-label">Operations</div>
        {routes.map((r) => (
          <a key={r.path} href={`#${r.path}`} aria-current={r.path === route.path ? "page" : undefined}>
            <Icon path={r.path} />
            {r.title}
            {r.path === "/alerts" && <span className="count">10</span>}
          </a>
        ))}
        <div className="me"><span className="avatar">DL</span><span><b>Dana Levi</b>Tier 1 analyst</span></div>
      </nav>
      <div className="content">
        <div className="topbar">
          <div className="search">
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><circle cx="7" cy="7" r="4.5" /><path d="m10.5 10.5 3 3" /></svg>
            Search alerts, hosts, IOCs
            <kbd>⌘K</kbd>
          </div>
          <div className="status"><i />All sensors healthy · 09:42 UTC</div>
        </div>
        <main className="main">
          <Screen />
        </main>
      </div>
    </div>
  );
}
