#!/usr/bin/env bash
# Back to the start of the demo: what Johnny knows goes back to the committed state (which already
# includes the demo Slack history, so his first message takes under a minute), and earlier runs,
# sketches, screenshots and option branches are removed. Branches already pushed to GitHub stay.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

git checkout -- knowledge/learned.json
for d in runs sketches shots slack-history; do rm -rf "${ROOT:?}/out/$d"; done
rm -f "$ROOT/out/opening.json" "$ROOT/out/slack-inbox.jsonl"

for wt in .worktrees/option-*; do [ -d "$wt" ] && git worktree remove --force "$wt"; done
git worktree prune
git for-each-ref --format='%(refname:short)' 'refs/heads/johnny/' | xargs -r git branch -D -q

echo "Demo reset. Start the bot with JOHNNY_DEMO_HISTORY=fixtures/slack-export npm run slack"
