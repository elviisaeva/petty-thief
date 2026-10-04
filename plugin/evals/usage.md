# Petty Thief token use (measured)

## Clean baseline vs optimized (2026-10-04)

Model: claude-opus-5-5 (Max account), Claude Code 2.1.284. Two runs per action and version, shown as `run 1 / run 2`.

Method: same 7 actions and links as the table further down, in a clean environment so the numbers match a fresh user: `claude -p '<prompt>' --setting-sources project --strict-mcp-config --mcp-config empty.json --plugin-dir <plugin> --no-session-persistence --permission-mode acceptEdits --allowedTools "Bash Read Write Edit Glob Grep WebFetch Skill" --output-format stream-json --verbose` (`empty.json` is `{"mcpServers":{}}`; the final `result` line is the same object `--output-format json` prints). The init message confirmed: no user or global CLAUDE.md, no auto-memory content, 0 MCP servers, only the petty-thief plugin, built-in skills only. (`--bare` needs an API key and `--disable-slash-commands` disables the skill itself, so neither was usable.) Each run gets a fresh temp project made by `plugin/evals/scaffold.sh` (profile with `save_dir: ./loot`, `pages: off`, quick depth, all tools off) and the fake stash on 127.0.0.1:8790; "Status change" uses `EVAL_PRESEED_WATCHLIST=yes`. Prompts: `steal this: https://www.youtube.com/watch?v=jNQXAC9IVRw` · `https://paulgraham.com/read.html` · `https://github.com/sindresorhus/awesome` · `#recipes https://www.bbcgoodfood.com/recipes/easy-pancakes` · `#watchlist https://myanimelist.net/anime/52991/Sousou_no_Frieren` · `Mark Frieren as watched.` · `lens:design,dev https://linear.app`. "Input" = fresh + cache read + cache creation. "Before" is the plugin at 8e9f8d1; "after" is this commit.

| Action | Turns before → after | Input before → after | Output before → after | Cost before → after |
|---|---|---|---|---|
| Quick analysis, video | 14 / 13 → 5 / 5 | 395k / 358k → 149k / 149k | 4.8k / 4.2k → 2.8k / 2.7k | $0.35 / $0.34 → $0.24 / $0.23 |
| Quick analysis, article | 10 / 10 → 6 / 6 | 356k / 314k → 188k / 188k | 3.6k / 3.9k → 3.1k / 3.5k | $0.31 / $0.31 → $0.25 / $0.26 |
| Quick analysis, repo | 10 / 14 → 6 / 6 | 369k / 417k → 229k / 230k | 4.4k / 5.3k → 4.2k / 3.8k | $0.37 / $0.39 → $0.40 / $0.40 |
| Collection add, recipe | 14 / 13 → 6 / 6 | 330k / 274k → 192k / 193k | 3.4k / 3.2k → 2.3k / 2.2k | $0.33 / $0.28 → $0.24 / $0.24 |
| Collection add, anime | 13 / 11 → 5 / 7 | 273k / 308k → 154k / 235k | 3.0k / 3.1k → 2.1k / 2.4k | $0.28 / $0.28 → $0.24 / $0.25 |
| Status change | 10 / 13 → 8 / 9 | 223k / 298k → 224k / 225k | 1.8k / 1.9k → 1.4k / 1.6k | $0.22 / $0.23 → $0.21 / $0.21 |
| Multi-lens analysis | 15 / 17 → 14 / 8 | 505k / 563k → 660k / 326k | 7.2k / 7.7k → 9.8k / 7.3k | $0.51 / $0.55 → $0.64 / $0.49 |
| **All 14 runs** | **177 → 97 (−45%)** | **4.98 M → 3.34 M (−33%)** | **57k → 49k** | **$4.76 → $4.29 (−10%)** |

What changed: `scripts/gather.sh` does tier 0 in one call (short-link expansion with headers only, platform detection, oEmbed, `og:`/`twitter:` meta, JSON-LD, YouTube public captions, article text or GitHub repo fields and README; output over 24 KB is shortened on screen and kept whole in a temp file, so it is never re-run). SKILL.md now opens each link with one call (profile, `gather.sh`, the references and lens the route needs), saves the analysis and all index appends in one Bash call with quoted heredocs, and does not re-read written files; status changes read the list and card once and edit both.

Quality (every produced file read): each analysis kept the `Seen:` / `Not seen:` line, the profile's goal sections, the lens extras (Steal this / Your hook, Rating, One exercise, Steal this for design) and the Stash section; no copied prose beyond one short attributed quote, as before. Word counts are the same or higher (for example multi-lens 724 / 619 → 795 / 687 words). Dev checks in the multi-lens run reached the same primary sources as the baseline (GitHub repo, npm, pricing, docs). Cards kept ingredients, steps, episodes, studio and where to watch. An intermediate version lost two things (the dev lens skipped its primary-source checks, and a video no longer tried captions). Both were fixed before these final runs: SKILL.md now says `gather.sh` covers the link and not the lens, and `gather.sh` tries captions.

Remaining cost: the multi-lens run varies with how much CSS the design lens pulls (one run fetched 30 stylesheets against design-extract's "at most 5"). Repo cost does not drop, because the 24 KB README lands in context in the first call (the baseline read it too, over more turns). The status change was already close to its minimum (Read the card, then Edit two files).

## Earlier measurement (owner's full setup)

Date: 2026-10-04. Model: claude-opus-5-5 (Max account). Claude Code 2.1.284.
Method: `claude -p '<prompt>' --plugin-dir plugin --output-format json --permission-mode acceptEdits --allowedTools "Bash Read Write Edit Glob Grep WebFetch Skill"` in a fresh temp project with a profile (`pages: off`, quick depth, tier 0 only, no downloads), one run per action, real public links. Numbers are the `usage` block of the JSON result: "input" = fresh + cache read + cache creation. One run each, so these are single measurements, not medians.

Caveat: these runs loaded the owner's normal Claude Code setup (global CLAUDE.md, many plugins and skills listed), so every turn re-reads a large cached prefix. The input figures are therefore an upper bound for a clean install; the output figures and the number of turns belong to Petty Thief itself.

Always-loaded cost (`claude plugin details petty-thief`): about 152 tokens per session (skill description only). The SessionStart hook costs no model context beyond one short note when links wait.

| Action | Link / prompt | Turns | Input (incl. cached) | Output | Cost |
|---|---|---|---|---|---|
| Quick analysis, video | YouTube "Me at the zoo", `steal this:` | 13 | 551,568 | 4,235 | $0.54 |
| Quick analysis, article | paulgraham.com/read.html | 9 | 478,281 | 3,098 | $0.47 |
| Quick analysis, repo | github.com/sindresorhus/awesome | 13 | 791,266 | 4,638 | $0.65 |
| Collection add, recipe | `#recipes` BBC Good Food easy pancakes | 12 | 356,738 | 2,602 | $0.44 |
| Collection add, anime | `#watchlist` MyAnimeList Frieren | 11 | 480,019 | 3,272 | $0.47 |
| Status change | `Mark Frieren as watched.` | 10 | 347,167 | 1,460 | $0.38 |
| Multi-lens analysis | `lens:design,dev` linear.app | 19 | 1,126,939 | 7,962 | $0.83 |

Per-action summary: quick analysis about 0.48-0.79 M input / 3-5 k output; collection add about 0.36-0.48 M / 2.6-3.3 k; status change about 0.35 M / 1.5 k; multi-lens about 1.1 M / 8 k.

Not measured: deep video (download plus frames), Pro-account session share ("Pro share not measured": no Pro account available), graded evals (`claude plugin eval` Bash sandbox blocks 127.0.0.1:8790, see below).

## Graded evals status

Graded eval suite: written, not yet run (the eval sandbox blocks the local fake server); unit and script tests run on every change.

`claude plugin eval` runs Bash in the OS sandbox, which blocks the local fake stash at 127.0.0.1:8790. `WebFetch(domain:127.0.0.1)` in `--allow-tools` does not help. Allowing it needs `sandbox.network.allowedDomains` (and `allowLocalBinding` on macOS) in the user's Claude settings, which is a security setting left to the owner. Until then the graded suite is unrun; the run results in `plugin/evals/results/` are invalid for cases that need the stash.
