// Host isolation takes production systems offline. Only an incident lead may run it.
// See context/decisions.md D-12.
export function canRunContainment(user) {
  return user.role === "incident_lead";
}
