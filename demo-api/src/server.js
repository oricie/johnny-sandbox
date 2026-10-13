import { createServer } from "node:http";
import { canEditScenario } from "./rules/approval.js";

const user = { role: process.env.DEMO_ROLE ?? "analyst" };

const scenarios = [
  { id: "base", name: "FY27 Base", status: "approved",
    lines: { Salaries: 4200000, Marketing: 900000, Cloud: 610000, Travel: 140000, Contractors: 380000 } },
  { id: "growth", name: "FY27 Growth", status: "draft",
    lines: { Salaries: 4650000, Marketing: 1250000, Cloud: 640000, Travel: 140000, Contractors: 310000 } },
  { id: "lean", name: "FY27 Lean", status: "draft",
    lines: { Salaries: 3980000, Marketing: 700000, Cloud: 610000, Travel: 90000, Contractors: 380000 } },
];

function send(res, status, body) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

// Route table. Atlas reads these paths to link frontend calls to handlers.
const routes = {
  "GET /api/scenarios": (_req, res) => send(res, 200, scenarios),
  "GET /api/me/permissions": (_req, res) =>
    send(res, 200, { role: user.role, canEditApproved: user.role === "finance_manager" }),
  "PATCH /api/scenarios/:id/lines": (req, res, params) => {
    const scenario = scenarios.find((s) => s.id === params.id);
    if (!scenario) return send(res, 404, { error: "not_found" });
    if (!canEditScenario(user, scenario)) return send(res, 403, { error: "approved_scenario_locked" });
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const { line, amount } = JSON.parse(body);
      scenario.lines[line] = amount;
      send(res, 200, scenario);
    });
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
