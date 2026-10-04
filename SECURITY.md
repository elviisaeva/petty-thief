# Security

Please report vulnerabilities privately through GitHub Security Advisories ("Report a vulnerability" on the repo's Security tab), not in public issues.

If your Claude Code key leaks, send `/rotate` to your bot: it revokes the old key and issues a new one.

Secrets live only in Cloudflare secrets (the bot token) and in your local `~/.petty-thief/config.json` (the Claude Code key). Nothing secret is stored in this repo.
