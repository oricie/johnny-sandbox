import type { Alert, Incident } from "../api/types";

const a = (id: string, title: string, severity: Alert["severity"], asset: string,
  assetCriticality: Alert["assetCriticality"], source: Alert["source"], fingerprint: string, detectedAt: string): Alert =>
  ({ id, title, severity, asset, assetCriticality, source, fingerprint, detectedAt, status: "new" });

export const seedAlerts: Alert[] = [
  a("AL-9012", "Suspicious PowerShell execution", "low", "test-runner-04", "test", "EDR", "ps-enc:test-runner-04", "2026-10-13T09:41:00Z"),
  a("AL-9011", "Suspicious PowerShell execution", "low", "test-runner-04", "test", "EDR", "ps-enc:test-runner-04", "2026-10-13T09:40:00Z"),
  a("AL-9010", "Credential dumping (LSASS access)", "critical", "dc-01", "crown-jewel", "EDR", "lsass:dc-01", "2026-10-13T09:38:00Z"),
  a("AL-9009", "Suspicious PowerShell execution", "low", "test-runner-04", "test", "EDR", "ps-enc:test-runner-04", "2026-10-13T09:37:00Z"),
  a("AL-9008", "Impossible travel sign-in", "medium", "okta:dana.levi", "internal", "Cloud", "travel:dana.levi", "2026-10-13T09:31:00Z"),
  a("AL-9007", "Phishing link clicked", "medium", "mail:omer.k", "internal", "Email", "phish:omer.k", "2026-10-13T09:22:00Z"),
  a("AL-9006", "Suspicious PowerShell execution", "low", "test-runner-04", "test", "EDR", "ps-enc:test-runner-04", "2026-10-13T09:20:00Z"),
  a("AL-9005", "Public S3 bucket created", "high", "s3:billing-exports", "production", "Cloud", "s3pub:billing-exports", "2026-10-13T09:12:00Z"),
  a("AL-9004", "Suspicious PowerShell execution", "low", "test-runner-04", "test", "EDR", "ps-enc:test-runner-04", "2026-10-13T09:05:00Z"),
  a("AL-9003", "Port scan from internal host", "low", "build-07", "internal", "SIEM", "scan:build-07", "2026-10-13T08:58:00Z"),
];

export const seedIncident: Incident = {
  id: "INC-311",
  title: "Credential dumping on domain controller",
  severity: "critical",
  host: "dc-01",
  alerts: ["AL-9010"],
  isolated: false,
};
