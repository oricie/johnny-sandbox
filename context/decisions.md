---
type: decision
---
# Product decisions

## D-07 · Comparison is always against the approved Base
status: active
scope: ["demo-app/src/screens/ScenarioComparison.tsx"]
Leadership reviews every draft relative to Base. Do not add free pairwise comparison yet.

## D-12 · Approved scenarios are frozen
status: active
scope: ["demo-api/src/rules/approval.js", "demo-app/src/screens/ScenarioEditor.tsx"]
Once approved, only a finance manager may edit a scenario. This is an audit requirement
from the CFO, not a UX choice. Locked cells are intentional. Do not make them editable,
do not hide the lock, and do not bypass the API check.

## D-15 · No new navigation items this quarter
status: active
scope: ["demo-app/src/App.tsx"]
We are mid user-research on navigation. Improve existing screens instead of adding new ones.
