import type { TgClient } from "./telegram";

export const BOT_COMMANDS = [
  { command: "list", description: "What's waiting in your stash" },
  { command: "done", description: "Recently analyzed links" },
  { command: "undo", description: "Remove the last link" },
  { command: "clear", description: "Clear this chat (your stash stays)" },
  { command: "connect", description: "Connect Claude Code (new key)" },
  { command: "rotate", description: "Key leaked? Get a new one" },
  { command: "forget", description: "Delete everything" },
  { command: "help", description: "How this works" },
];

/** Bump when the commands or texts above change: running bots re-apply branding once. */
export const BRANDING_VERSION = "2";

export const BOT_DESCRIPTION =
  "I'm your petty thief. 🦝\n\nForward me TikToks, Reels, Shorts, repos, articles: anything worth stealing an idea from. I keep them safe until you open Claude Code, then Claude breaks them down: the hook, the format, the trick.\n\nIdeas, not content.";

export const BOT_SHORT_DESCRIPTION = "Stash links on the go. Claude steals the ideas later.";

/** Best-effort: a branding failure must never break setup or /connect. */
export async function applyBranding(tg: TgClient): Promise<void> {
  const calls: [string, Record<string, unknown>][] = [
    ["setMyCommands", { commands: BOT_COMMANDS }],
    ["setMyDescription", { description: BOT_DESCRIPTION }],
    ["setMyShortDescription", { short_description: BOT_SHORT_DESCRIPTION }],
  ];
  for (const [method, body] of calls) {
    try {
      await tg.call(method, body);
    } catch {
      // ignore
    }
  }
}
