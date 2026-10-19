#!/usr/bin/env bash
# Start Johnny on a server: clone or update the repo in the persistent volume, install, connect to Slack.
# Needs: JOHNNY_ANTHROPIC_KEY, JOHNNY_SLACK_BOT_TOKEN, JOHNNY_SLACK_APP_TOKEN, GITHUB_TOKEN
# (fine-grained, Contents read/write on the repo). Optional: JOHNNY_NETLIFY_TOKEN, REPO (owner/name).
set -euo pipefail
: "${JOHNNY_ANTHROPIC_KEY:?missing}" "${JOHNNY_SLACK_BOT_TOKEN:?missing}" "${JOHNNY_SLACK_APP_TOKEN:?missing}" "${GITHUB_TOKEN:?missing}"
REPO="${REPO:-oricie/johnny-sandbox}"
DIR="${DATA_DIR:-/data}/johnny-sandbox"
mkdir -p "$(dirname "$DIR")"

# The token goes through a credential helper, not into the remote URL, so it never lands in .git/config.
git config --global credential.helper '!f() { echo "username=x-access-token"; echo "password=${GITHUB_TOKEN}"; }; f'
git config --global user.name "Johnny"
git config --global user.email "johnny@users.noreply.github.com"

if [ -d "$DIR/.git" ]; then
  # Fast-forward only: if what Johnny learned on the server conflicts with main, keep running the code we have.
  git -C "$DIR" fetch -q origin main && git -C "$DIR" merge -q --ff-only origin/main || echo "main didn't fast-forward; running the current checkout"
else
  git clone -q "https://github.com/${REPO}.git" "$DIR"
fi

cd "$DIR"
npm ci --no-audit --no-fund
exec npm run slack
