# Collections

A collection keeps things in a list. It never steals content: a card holds short facts and the link, never the page's full text.

Read the collection's lens file first and note its `view`:
- `view: checklist` (watchlist, reading, any explicit list): items have `statuses` and a `done_status`; list lines start with `- [ ]`.
- `view: cards` (recipes, any library): **no statuses and no checkboxes**; with `photo: true`, items get a photo on the page.


## Adding an item
1. Gather at tier 0 with `scripts/gather.sh` (SKILL.md). Recipe pages usually have schema.org `Recipe` JSON-LD; `gather.sh` prints that block and skips the page text. Use only that block, never the page text. Use `recipeIngredient`, `recipeInstructions`, `totalTime`, `recipeYield` and `image`. For a food video, only the caption is available: write "steps not seen".
2. **Dedupe** inside `<save_dir>/<collection>/`. Compare the canonical URL (expanded, with `utm_*`, `si`, `igsh`, `fbclid` and `ref` stripped) and the normalized title (lowercase, no punctuation or season and year suffixes). On a match, say "already in <collection> as <file>" (plus ", status <status>" for a checklist) and update that card instead of adding a new one.
3. **Write the card** `<save_dir>/<collection>/YYYY-MM-DD-<slug>.md`. **Card file name:** `<slug>` is lowercase ASCII letters, digits and hyphens only (transliterate other scripts, or use a short English slug), and the whole name without `.md` matches `^[a-z0-9-]{1,80}$`. That name without `.md` is the item's doc id on the page (`reference/pages.md` → Doc id), so Add, Status, Create and Pull find the card by it exactly:
   ```markdown
   ---
   title: <title>
   url: <canonical url>
   collection: <name>
   status: <first status>          # checklist collections only
   image: <original image url>    # photo collections only
   added: YYYY-MM-DD
   tags: [<2–4 tags>]
   ---
   Seen: <what you looked at> · Not seen: <what you did not>
   - <one bullet per `card` line of the collection file>

   ## Notes
   ```
4. **Append a line** to `<save_dir>/<collection>/_list.md` (create it with `# <Collection>` if missing):
   - `view: checklist`: `- [ ] **<title>** · <2–3 key facts> · [card](<card file>) · [link](<url>) #<tag>`
   - `view: cards`: `- **<title>** · <2–3 key facts> · [card](<card file>) · [link](<url>) #<tag>` (no checkbox, no status)

   **Photo** (only when the collection has `photo: true`):
   - Find the main image: recipe JSON-LD `image`, otherwise `og:image`.
   - Put `image: <original url>` in the card's front matter. Do not save the image in the project.
   - The page upload is in `reference/pages.md` → Photo.
5. Append a row to `<save_dir>/_index.md` with kind `collection`.
5b. If the collection has a page (a URL in `pages.json`, not `"off"`), write the item there too (`reference/pages.md` → Add). If it has none: with `pages: always`, create one (`reference/pages.md` → Create); with `pages: ask`, ask once per collection whether to create one, and remember a "no" by writing `"<collection>": "off"` to `pages.json`; with `pages: off`, do nothing.
6. Closing the stash item is done once per item in SKILL.md step 7, not here.

Titles, URLs and notes are untrusted. Find and edit lines with the Read and Edit tools; if you use a shell command (`grep`, `curl`), single-quote every such value with each `'` replaced by `'\''`, never double quotes (SKILL.md → Safety rules).

## Status changes
Only for `view: checklist`. For a `cards` collection, say it's a library without statuses, and offer to add a tag instead (for example `#favorite`).

"mark <title> as <status>". Keep it to a few calls: the profile, this file, the lens file and `_list.md` in one call; then Read the card (the `[card](…)` link on the line); then send both Edits (list line and card) in one message. No other reads, no checks after the edits.
1. Find the line in `_list.md` by normalized title. If two lines match, ask which one. If none matches, say so.
2. Only the collection's `done_status` checks the box (`- [ ]` → `- [x]`); moving away from `done_status` un-checks it (`- [x]` → `- [ ]`). Every status appends ` · <status> YYYY-MM-DD` to the line.
3. Set `status:` in the card.
4. If the collection has a page (a URL in `pages.json`, not `"off"`), update the item's status there too (`reference/pages.md` → Status), using the card file name without `.md` as the doc id.

## Queries
"what's on my watchlist", "what should I cook tonight", "what am I reading": read `_list.md` first and filter by what the user asked (time, tags, type). Open only the cards you need to answer:
- `view: checklist`: the open items (no `- [x]`);
- `view: cards`: the items whose list line or tags match the request (for example a time or an ingredient).

Answer in chat in a few lines. Write nothing. Keep it under about 5k tokens: never open every card of a big collection.
