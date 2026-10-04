#!/bin/sh
# Prepares an eval workspace: project-level Petty Thief dir, config pointing at the fake stash, optional profile, seeded items.
set -eu
mkdir -p .petty-thief loot
printf '{\n  "url": "http://127.0.0.1:8790",\n  "token": "pt_evals_not_a_secret_0000000000"\n}\n' > .petty-thief/config.json
chmod 600 .petty-thief/config.json
if [ "${EVAL_PROFILE:-yes}" = "yes" ]; then
  cat > .petty-thief/profile.yaml <<EOF
language: en
save_dir: ./loot
default_lens: auto
default_depth: quick
about: Product designer who posts short videos about building with AI, for indie makers.
goals:
  - { key: post, label: "For my content" }
  - { key: process, label: "For my workflow" }
avoid: [politics]
use: [${EVAL_USE:-creator, dev, ai, learn, design, watchlist, recipes, reading}]
routes: {}
pages: ${EVAL_PAGES:-off}
analyzer: built-in
tools: { logged_in_browser: false, download_video: false, transcribe: false }
EOF
fi
if [ "${EVAL_PRESEED_WATCHLIST:-no}" = "yes" ]; then
  mkdir -p loot/watchlist
  cat > loot/watchlist/_list.md <<'LIST'
# Watchlist

- [ ] **Frieren: Beyond Journey's End** · anime · 28 ep · [card](2026-10-01-frieren.md) · [link](http://127.0.0.1:8790/fixtures/anime.html) #fantasy
- [ ] **Dandadan** · anime · 12 ep · [card](2026-10-01-dandadan.md) · [link](https://example.com/dandadan) #action
LIST
  cat > loot/watchlist/2026-10-01-frieren.md <<'CARD'
---
title: "Frieren: Beyond Journey's End"
url: http://127.0.0.1:8790/fixtures/anime.html
collection: watchlist
status: to-watch
added: 2026-10-01
tags: [anime, fantasy]
---
CARD
fi
curl -sf -X POST --data "${EVAL_SEED:-[]}" http://127.0.0.1:8790/__reset > /dev/null
