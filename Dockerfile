# Johnny, always on. Playwright's image brings Node and Chromium (screenshots, sketches, walking a product);
# git runs the branches and worktrees, ripgrep is how he searches code.
FROM mcr.microsoft.com/playwright:v1.56.0-noble

RUN apt-get update && apt-get install -y --no-install-recommends git ripgrep && rm -rf /var/lib/apt/lists/*

# The repo is cloned at startup into the persistent volume (/data), not copied into the image:
# runs need a real git checkout for branches and worktrees, and what Johnny learns has to survive deploys.
COPY deploy/start.sh /usr/local/bin/johnny-start
RUN chmod +x /usr/local/bin/johnny-start

ENV DATA_DIR=/data
CMD ["johnny-start"]
