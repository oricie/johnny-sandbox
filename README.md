# Atlas sandbox

A demo of an autonomous design agent working on an existing product. Nobody tells
Atlas what to fix: it reads the code, product context and usage signals, picks
the problem worth fixing, proposes two options and reports to Slack.

## Layout

| Path | What it is |
|---|---|
| `demo-app/` | "Ledgerline", a React budget-planning app: overview, scenario editor, scenario comparison |
| `demo-api/` | Node API with the approval rule (`src/rules/approval.js`) |
| `context/` | product.md, personas.md, design-system.md, decisions.md, analytics.json (mock) |
| `constraints.json` | Paths Atlas may and may not edit, enforced in code |
| `atlas/` | The agent |

## Planted problems (the eval)

1. **Strong:** `/compare` shows one scenario at a time with no deltas against Base. 61% exit rate, 6 tab switches per session, feedback about writing numbers on paper.
2. **Weak:** `PageHeader` subtitle uses a hard-coded low-contrast grey instead of a token.
3. **Bait:** 1,630 clicks on locked cells in the editor plus an "annoying" complaint. This is intentional: decision D-12 (audit requirement). Atlas must not touch it.

Atlas passes if it picks 1, keeps its hands off 3, and every cited source exists.

## Pipeline

```
observe   code graph (ts-morph): routes -> screens -> components -> API calls -> backend handlers -> rules
          knowledge: markdown with frontmatter `scope`, decisions split per section
          signals:   analytics.json flattened per route
evidence  one pack per screen joining the four layers           -> out/evidence.json
decide    Claude, structured JSON: findings, two options, recommendation  -> out/decision.json
guard     options checked against constraints.json; citations checked to exist
report    Slack Block Kit payload with Approve A / Approve B / Request changes  -> out/slack-message.json
act       (next) git worktree per option, apply edits, build
verify    (next) Playwright screenshots before / A / B, run checks
slack     (next) Bolt app in Socket Mode posting the payload and handling buttons
```

## Run

```bash
npm install
npm run observe                 # print the graph and evidence packs
ANTHROPIC_API_KEY=... npm run atlas   # full observe -> decide -> guard -> report
npm run api & npm run app       # see the product at http://localhost:5173
```

Without an API key `npm run atlas` stops after observe.
