# Output

File:
- analysis lenses: `<save_dir>/YYYY-MM-DD-<author-or-domain>-<slug>.md`;
- **design only:** `<save_dir>/design/YYYY-MM-DD-<slug>.md`. If the link also gets any other analysis lens (for example `lens:design,dev`), the one shared file goes to `<save_dir>/`, not `design/`;
- collections: `<save_dir>/<collection>/…` (see `collections.md`).

`YYYY-MM-DD` is the local date. The slug is lowercase, 2–5 words, joined by hyphens.

```markdown
# <Author> · <title or topic>
Seen: <what you looked at> · Not seen: <what you did not>
<url> · <YYYY-MM-DD> · lens: <lens> · depth: <quick|deep> · format: <format>

## What it is
## Why it works
## <lens-specific key finding, e.g. "Hook" for creator, "Does it exist?" for dev>
## Breakdown
<table by second or slide when deep; bullets when quick>
## Numbers
## <goal 1 label from the profile>
## <goal 2 label from the profile>
## <lens verdict extras>
## Not verified
```

With several analysis lenses, keep the shared sections once (What it is, Numbers, Not verified, Stash). Put each lens's key finding, breakdown, goal sections and extras under its own `## Lens: <name>` heading. The header line lists `lens: design+dev`.

```markdown
## Stash
<the patterns added to _stash.md, or "none">
```

Quick depth keeps the whole file to about 15 lines of content. The design lens on a case (Behance, Dribbble, a portfolio) may run longer: its logo, screen, motion and case-structure sections are the point.

`_index.md` (create it with this header if missing, then append one row per analysis):

```markdown
| Date | Link | Kind | Lenses | Verdict | File |
|---|---|---|---|---|---|
```

`_ideas.md`: append `- <idea> (from <file>)`.

`_stash.md`: append under `## <lens>` headings: `- <pattern> — e.g. <file>`.
