// worker/src/chat.ts
// Clearing the chat with the owner. The stash lives in the database, so the chat can go:
// links, notes and picks stay. Telegram lets a bot delete messages in a private chat only
// within 48 hours of sending, so the bot remembers the ids of recent messages for that long.
import type { TgClient } from "./telegram";

/** Telegram's limit for deleting messages, with a margin so a request never fails on the edge. */
export const DELETE_WINDOW_MS = 47 * 60 * 60 * 1000;

export async function rememberMessage(db: D1Database, messageId: unknown, now: number): Promise<void> {
  if (typeof messageId !== "number" || !Number.isSafeInteger(messageId)) return;
  await db.batch([
    db.prepare("INSERT OR IGNORE INTO chat_messages (message_id, sent_at) VALUES (?, ?)").bind(messageId, now),
    db.prepare("DELETE FROM chat_messages WHERE sent_at < ?").bind(now - DELETE_WINDOW_MS),
  ]);
}

/** Deletes every remembered message still inside the window. Returns how many were deleted. */
export async function clearChat(db: D1Database, tg: TgClient, chatId: number, now: number): Promise<number> {
  const { results } = await db
    .prepare("SELECT message_id FROM chat_messages WHERE sent_at >= ? ORDER BY message_id")
    .bind(now - DELETE_WINDOW_MS)
    .all<{ message_id: number }>();
  const ids = results.map((r) => r.message_id);
  let deleted = 0;
  for (let i = 0; i < ids.length; i += 100) {
    const chunk = ids.slice(i, i + 100);
    const r = await tg.call("deleteMessages", { chat_id: chatId, message_ids: chunk });
    if (r?.ok) deleted += chunk.length;
  }
  await db.prepare("DELETE FROM chat_messages").run();
  return deleted;
}

export const CLEAR_PROMPT =
  "Clear this chat? Your stash stays: every link, note and lens pick is kept for Claude Code.\nTelegram lets me delete only the last 48 hours. For older messages use Clear history in the chat menu.";

export const clearKeyboard = {
  inline_keyboard: [[{ text: "🧹 Clear chat", callback_data: "c:yes" }, { text: "Cancel", callback_data: "c:no" }]],
};
