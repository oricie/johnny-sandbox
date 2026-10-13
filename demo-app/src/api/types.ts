export type Severity = "critical" | "high" | "medium" | "low";

export interface Alert {
  id: string;
  title: string;
  severity: Severity;
  asset: string;
  assetCriticality: "crown-jewel" | "production" | "internal" | "test";
  source: "EDR" | "SIEM" | "Cloud" | "Email";
  fingerprint: string; // same detection on the same asset
  detectedAt: string; // ISO
  status: "new" | "investigating" | "closed";
}

export interface Incident {
  id: string;
  title: string;
  severity: Severity;
  host: string;
  alerts: string[];
  isolated: boolean;
}

export interface Permissions {
  role: "analyst" | "incident_lead" | "viewer";
  canRunContainment: boolean;
}
