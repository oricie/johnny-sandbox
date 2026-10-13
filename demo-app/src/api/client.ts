import type { Alert, Incident, Permissions } from "./types";
import { seedAlerts, seedIncident } from "../data/seed";

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

export function getAlerts(): Promise<Alert[]> {
  return get("/api/alerts", seedAlerts);
}

export function getIncident(id: string): Promise<Incident> {
  return get(`/api/incidents/${id}`, seedIncident);
}

export function getPermissions(): Promise<Permissions> {
  return get("/api/me/permissions", { role: "analyst", canRunContainment: false });
}

export async function isolateHost(incidentId: string): Promise<boolean> {
  const res = await fetch(`/api/incidents/${incidentId}/isolate`, { method: "POST" }).catch(() => null);
  return Boolean(res?.ok);
}
