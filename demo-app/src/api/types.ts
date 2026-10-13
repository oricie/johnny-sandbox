export type ScenarioStatus = "draft" | "approved";

export interface Scenario {
  id: string;
  name: string;
  status: ScenarioStatus;
  lines: Record<string, number>; // budget line -> amount
}

export interface Permissions {
  role: "analyst" | "finance_manager" | "viewer";
  canEditApproved: boolean;
}
