# FAQ

## How do I update Petty Thief?
Plugin: run `claude plugin update petty-thief@petty-thief`, or say "update the petty-thief plugin" in Claude Code. Your profile, lenses, pages and loot live outside the plugin, so updates never touch them.

Bot: updates to the bot (your Cloudflare worker) are rare, and the release notes say when one is needed. The Deploy button made a copy of the repo, not a fork, so there is nothing to sync: press the Deploy button again on the new version. Developers can instead pull the original repo and run `npm run deploy:dev` in `worker/`.

## How do I remove it completely?
1. In Claude Code: `claude plugin uninstall petty-thief@petty-thief`.
2. In Telegram: send `/forget yes` to your bot to delete all stored links.
3. In Cloudflare: delete the `petty-thief` worker (Workers & Pages → petty-thief → Settings → Delete) and its D1 database (Storage & Databases → D1 → petty-thief → Delete).
4. In Telegram: open @BotFather, send `/deletebot`, and pick your bot.
5. Optionally delete `~/.petty-thief/` and your copy of the repo on GitHub. Your loot folder is yours to keep.

## Does it work on Windows?
Yes, in Claude Code for Windows. The session reminder and the stash commands are `sh` scripts; Claude Code on Windows runs them with Git Bash, which it already needs. Recipe photos are resized with ImageMagick (`magick`) instead of the macOS-only `sips`; without either, cards simply have no photo.

## Where is my data, and how do I export it?
- **Your loot is plain Markdown** in your `save_dir` (`~/Petty Thief` by default): analyses, `_index.md`, and one folder per collection. That folder is the export: copy it anywhere.
- **The stash** in Cloudflare holds only link text, your note and its status.
- **Collection pages** on claude.ai hold the status you tick on your phone. Petty Thief copies statuses back into your `_list.md` files before it works on a collection.

## I have more than 200 links waiting.
That's fine. The API hands them out in pages (up to 200 at a time), and Petty Thief lists and works through them 20 at a time. Nothing is lost while you wait. The bot accepts up to 200 new links per day.

## Why does the bot say "daily limit" before midnight?
The daily cap counts UTC days, so it resets at midnight UTC. File names use your local date.

## Can the bot speak my language?
The bot's replies are English in v1. Analyses and collection cards use the `language` in your profile.

## Can a project have its own settings?
Yes. Ask Claude "use separate Petty Thief settings for this project". It creates `./.petty-thief/` in the project (profile and lenses) and adds `.petty-thief/config.json` to the project's `.gitignore` as a precaution, so a key can never be committed. Inside that project, these settings win over `~/.petty-thief/`. The connection to your bot stays the shared one in `~/.petty-thief/`.

## I use Petty Thief in several projects. Can links go to just one?
Yes. In a project, tell Claude "name this project brand for the bot". It writes `stash_tag: brand` to `./.petty-thief/profile.yaml`. Then add `*brand` anywhere in the note when you send a link (`*brand look at the hook`); the bot replies `✓ stashed for *brand` and `/list` shows the tag. Only that project picks the link up. Untagged links go to any project, unless a tagged one has `take_untagged: false`. A project without a name works on untagged links and tells you about tagged ones waiting elsewhere; say "take them here" to handle them anyway. A mistyped tag (`*bran`) is never lost: Claude asks where it belongs. Sent a link to the wrong project? Send it again with the right tag; the bot replies `Moved to *home`.
