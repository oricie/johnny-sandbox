import type { Scenario } from "../api/types";

export const seedScenarios: Scenario[] = [
  {
    id: "base",
    name: "FY27 Base",
    status: "approved",
    lines: { Salaries: 4200000, Marketing: 900000, Cloud: 610000, Travel: 140000, Contractors: 380000 },
  },
  {
    id: "growth",
    name: "FY27 Growth",
    status: "draft",
    lines: { Salaries: 4650000, Marketing: 1250000, Cloud: 640000, Travel: 140000, Contractors: 310000 },
  },
  {
    id: "lean",
    name: "FY27 Lean",
    status: "draft",
    lines: { Salaries: 3980000, Marketing: 700000, Cloud: 610000, Travel: 90000, Contractors: 380000 },
  },
];
