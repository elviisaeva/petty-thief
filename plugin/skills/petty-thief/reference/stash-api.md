# Stash commands

Run the script by its absolute path, built from this skill's base directory (`sh "<skill base dir>/scripts/stash.sh" …`). Never `cd` into the skill folder: the config is looked up from the current working directory. Never call the API with the token on the command line: the scripts pass it to `curl` through stdin.

Below, `STASH` stands for `sh "<skill base dir>/scripts/stash.sh"`. Every other value is untrusted and goes in single quotes, with each `'` in it replaced by `'\''` (SKILL.md → Safety rules). Never use double quotes around a summary, reason, file name or URL: titles quoted from a page can contain `$(…)`.

| Command | Output |
|---|---|
| `printf '%s\n' '<token>' \| STASH connect '<url>'` | `Connected. N links waiting.` (the token is read from stdin; the url must be `https://`) |
| `STASH host` | The connected url, never the token. Prints nothing and fails when not connected. |
| `STASH count` | `N` (only the links this project takes, see below) |
| `STASH list [waiting\|done\|skipped] [limit] ['<tag>']` | `{"items":[{"id","url","note","source","status","tag","created_at",…}]}`, waiting oldest first; 20 items unless `limit` (1–200) says otherwise. With `<tag>`: exactly the links tagged `<tag>` |
| `STASH tags` | One `<tag> <n>` line per tag with waiting links (all tags, whatever this project's filter) |
| `STASH done '<id>' '<lens>' '<summary>' '<file>'` | `{"ok":true}` |
| `STASH skip '<id>' '<reason>'` | `{"ok":true}` |

- `count` and `list` follow the profile's `stash_tag` and `take_untagged` (project profile first, then `~/.petty-thief/profile.yaml`). With `stash_tag: brand` they ask the worker for `tag=brand&untagged=1` (or `untagged=0` when `take_untagged` is false/no/off/0). Without `stash_tag` (or with an empty one in the project profile) they ask for `untagged=only`. A malformed `stash_tag` stops both with `petty-thief: stash_tag …`: fix the profile (1–32 lowercase letters, digits or hyphens, starting and ending with a letter or digit).
- Run `count` before `list`, and say "showing 20 of N" when N is larger. Do not raise the limit to see everything: work in batches of 20.
- With several lenses, pass them joined with `+` as `<lens>` (`recipes+creator`).
- Errors go to stderr starting with `petty-thief:` (for example `petty-thief: HTTP 401 …`). Show them to the user as they are. A 401 means the key was replaced: send `/connect` to the bot and paste the new message.
