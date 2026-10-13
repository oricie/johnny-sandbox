import type { Permissions, Scenario } from "./types";
import { seedScenarios } from "../data/seed";

// Falls back to seed data when demo-api is not running, so the UI always renders.
async function get<T>(url: string, fallback: T): Promise<T> {
  try {
    const res = await fetch(url);
    if (!res.ok) return fallback;
    return (await res.json()) as T;
  } catch {
    return fallback;
  }
}

export function getScenarios(): Promise<Scenario[]> {
  return get("/api/scenarios", seedScenarios);
}

export function getPermissions(): Promise<Permissions> {
  return get("/api/me/permissions", { role: "analyst", canEditApproved: false });
}

export async function updateLine(scenarioId: string, line: string, amount: number): Promise<boolean> {
  const res = await fetch(`/api/scenarios/${scenarioId}/lines`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ line, amount }),
  }).catch(() => null);
  return Boolean(res?.ok);
}
