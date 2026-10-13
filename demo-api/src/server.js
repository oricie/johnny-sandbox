import { createServer } from "node:http";
import { canRunContainment } from "./rules/containment.js";

const user = { role: process.env.DEMO_ROLE ?? "analyst" };

const alert = (id, title, severity, asset, assetCriticality, source, fingerprint, detectedAt) =>
  ({ id, title, severity, asset, assetCriticality, source, fingerprint, detectedAt, status: "new" });

const alerts = [
  alert("AL-9012", "Suspicious PowerShell execution", "low", "test-runner-04", "test", "EDR", "ps-enc:test-runner-04", "2026-10-13T09:41:00Z"),
  alert("AL-9011", "Suspicious PowerShell execution", "low", "test-runner-04", "test", "EDR", "ps-enc:test-runner-04", "2026-10-13T09:40:00Z"),
  alert("AL-9010", "Credential dumping (LSASS access)", "critical", "dc-01", "crown-jewel", "EDR", "lsass:dc-01", "2026-10-13T09:38:00Z"),
  alert("AL-9009", "Suspicious PowerShell execution", "low", "test-runner-04", "test", "EDR", "ps-enc:test-runner-04", "2026-10-13T09:37:00Z"),
  alert("AL-9008", "Impossible travel sign-in", "medium", "okta:dana.levi", "internal", "Cloud", "travel:dana.levi", "2026-10-13T09:31:00Z"),
  alert("AL-9007", "Phishing link clicked", "medium", "mail:omer.k", "internal", "Email", "phish:omer.k", "2026-10-13T09:22:00Z"),
  alert("AL-9006", "Suspicious PowerShell execution", "low", "test-runner-04", "test", "EDR", "ps-enc:test-runner-04", "2026-10-13T09:20:00Z"),
  alert("AL-9005", "Public S3 bucket created", "high", "s3:billing-exports", "production", "Cloud", "s3pub:billing-exports", "2026-10-13T09:12:00Z"),
  alert("AL-9004", "Suspicious PowerShell execution", "low", "test-runner-04", "test", "EDR", "ps-enc:test-runner-04", "2026-10-13T09:05:00Z"),
  alert("AL-9003", "Port scan from internal host", "low", "build-07", "internal", "SIEM", "scan:build-07", "2026-10-13T08:58:00Z"),
];

const incidents = [
  { id: "INC-311", title: "Credential dumping on domain controller", severity: "critical", host: "dc-01", alerts: ["AL-9010"], isolated: false },
];

function send(res, status, body) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

// Route table. Johnny reads these paths to link frontend calls to handlers.
const routes = {
  "GET /api/alerts": (_req, res) => send(res, 200, alerts),
  "GET /api/me/permissions": (_req, res) =>
    send(res, 200, { role: user.role, canRunContainment: user.role === "incident_lead" }),
  "GET /api/incidents/:id": (_req, res, params) => {
    const incident = incidents.find((i) => i.id === params.id);
    return incident ? send(res, 200, incident) : send(res, 404, { error: "not_found" });
  },
  "POST /api/incidents/:id/isolate": (_req, res, params) => {
    const incident = incidents.find((i) => i.id === params.id);
    if (!incident) return send(res, 404, { error: "not_found" });
    if (!canRunContainment(user)) return send(res, 403, { error: "incident_lead_required" });
    incident.isolated = true;
    send(res, 200, incident);
  },
};

createServer((req, res) => {
  for (const [key, handler] of Object.entries(routes)) {
    const [method, pattern] = key.split(" ");
    const re = new RegExp("^" + pattern.replace(/:(\w+)/g, "(?<$1>[^/]+)") + "$");
    const m = req.method === method && req.url.match(re);
    if (m) return handler(req, res, m.groups ?? {});
  }
  send(res, 404, { error: "no_route" });
}).listen(4100, () => console.log(`demo-api on :4100 as ${user.role}`));
