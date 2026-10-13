// Approved scenarios are frozen for everyone except finance managers.
// See context/decisions.md D-12.
export function canEditScenario(user, scenario) {
  if (scenario.status !== "approved") return user.role !== "viewer";
  return user.role === "finance_manager";
}
