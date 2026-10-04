# Make Petty Thief yours

## Your profile
`~/.petty-thief/profile.yaml` (or `.petty-thief/profile.yaml` inside a project, which wins there) holds:

| Field | What it does |
|---|---|
| `about` | Who you are and who you make things for. The single biggest lever for useful verdicts. |
| `goals` | The verdict sections you get, in order, e.g. "For my content", "For my workflow". |
| `avoid` | Topics never to suggest. |
| `use` | The lenses and collections Petty Thief may pick on its own, e.g. `[creator, design, recipes]`. "Turn off the dev lens" removes one. |
| `routes` | Websites that always go to one lens or collection, e.g. `{ dribbble.com: design, myanimelist.net: watchlist }`. They win over the built-in routes. |
| `pages` | Collection pages on claude.ai: `ask` (default, asks once per collection), `always`, or `off`. |
| `default_lens`, `default_depth` | What happens when your note says nothing. |
| `language`, `save_dir` | Where analyses go and in which language. |
| `batch_size` | Links handled per run, then Petty Thief asks to continue. Default 5; `0` means no limit (for Max users). |
| `remind` | `true` (default) or `false`. With `false` the session-start reminder about waiting links stays quiet. Put it in `./.petty-thief/profile.yaml` for one project, or in `~/.petty-thief/profile.yaml` as a global default; the project file wins. |
| `stash_tag` | This project's name for the bot, for example `brand` (1–32 lowercase letters, digits or hyphens). Links sent with `*brand` in the note go to this project only. Set it in `./.petty-thief/profile.yaml`, or ask Claude "name this project brand for the bot". Without it (or with an empty `stash_tag:`, which also overrides a global one), a project takes untagged links only and tells you about tagged ones waiting elsewhere. |
| `take_untagged` | `true` (default) or `false` (`yes`/`no`, `on`/`off`, `1`/`0` work too). With `stash_tag` set, `false` means this project takes only its own `*tag` links and leaves untagged ones for other projects. |
| `analyzer` | The name of your own analysis skill, if you have one. Petty Thief still handles the stash. |
| `tools` | Deep tools you allow. You are still asked for each item. |

Just ask Claude: "change my Petty Thief goals to …".

## Your own lens or collection
Say "make a lens for UX research" (or podcasts, ads, landing pages…) or "set up a collection for board games". Claude asks at most 4 questions and writes `~/.petty-thief/lenses/<name>.md`. Both are short Markdown files with a small header:

| Field | Lens | Collection | What it does |
|---|---|---|---|
| `name` | yes | yes | What you type in a note: `lens:ux` or `#board-games`. |
| `kind` | `lens` | `collection` | Understand links, or keep them. |
| `for` | yes | yes | Who it's for, one line. |
| `keywords` | yes | yes | Words in your note that pick it, in any language. |
| `routes` | optional | optional | Websites that always go here. |
| `view` | — | `checklist` or `cards` | A list you work through (checkboxes and statuses) or a library you keep (cards, no statuses). |
| `statuses`, `done_status` | — | checklist only | e.g. `[want, own, played]` and `played`; the done status ticks the box. |
| `photo` | — | cards only | `true` shows each item's main image on its page. |
| `card` | — | yes | The bullets every item card fills. |

A lens:

```markdown
---
name: ux
kind: lens
for: product designers
keywords: [ux, onboarding, флоу]
---
# Lens: ux
## Look at
- …
## Verdict extras
- …
```

A collection (more examples: a `places` checklist of cafés to try, a `wishlist` library with photos):

```markdown
---
name: places
kind: collection
for: cafés and places to try
keywords: [cafe, restaurant, bar, place, кафе, ресторан]
routes: [maps.google.com, yelp.com]
view: checklist
statuses: [to-try, been]
done_status: been
card:
  - Area · price level · what it's known for
  - Why saved (from the note)
---
```

Your lenses and collections override built-in ones with the same name and survive updates. Made a good one? Open a pull request and add it to `plugin/skills/petty-thief/lenses/`.

## Change the skill itself
The skill is plain Markdown in `plugin/skills/petty-thief/`. Ask Claude to change the output template, add a platform to `reference/gather.md`, or tighten the gentle-mode limits. Changes there are overwritten by plugin updates, so keep personal preferences in your profile and lenses.
