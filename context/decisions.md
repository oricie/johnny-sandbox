---
type: decision
---
# Product decisions

## D-07 · Every raw alert stays visible
status: active
scope: ["demo-app/src/components/AlertList.tsx", "demo-app/src/screens/AlertQueue.tsx"]
Our SOC 2 audit requires that analysts can see every alert we ingested. Grouping or
prioritising is fine, but never auto-close, drop or permanently hide an alert.

## D-12 · Containment needs an incident lead
status: active
scope: ["demo-api/src/rules/containment.js", "demo-app/src/screens/IncidentResponse.tsx"]
Isolating a host can take production offline. After a 2025 outage caused by an analyst
isolating the payments gateway, only incident leads may run containment. This is a
deliberate control, not a UX gap. Do not enable the button for analysts, do not hide
the restriction, and do not bypass the API check.

## D-15 · No new navigation items this quarter
status: active
scope: ["demo-app/src/App.tsx"]
We are mid user-research on navigation. Improve existing screens instead of adding new ones.
