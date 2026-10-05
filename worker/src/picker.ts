// worker/src/picker.ts
// Buttons under "✓ stashed": pick lenses, frame-by-frame depth and the project for a link,
// so nobody has to remember what to type. A pick is stored on the link and reaches the skill
// inside the note, in the words a user could type ("lens:design deep").
import type { Env } from "./env";
import * as db from "./db";
import { TAG_NAME_RE } from "./urls";
import type { TgClient } from "./telegram";

/** Shown until a Claude Code session has sent the project's own lens names. */
export const DEFAULT_LENSES = ["creator", "dev", "ai", "learn", "design"];
/** The skill applies at most 3 lenses per link. */
export const MAX_PICKS = 3;
const MAX_LENS_BUTTONS = 12;
const MAX_PROJECT_BUTTONS = 12;
/** Projects not synced for this long drop off the project buttons. */
export const PROJECT_TTL_MS = 180 * 24 * 60 * 60 * 1000;

type Button = { text: string; callback_data: string };
export type Keyboard = { inline_keyboard: Button[][] };

const rows = (buttons: Button[], perRow: number): Button[][] => {
  const out: Button[][] = [];
  for (let i = 0; i < buttons.length; i += perRow) out.push(buttons.slice(i, i + perRow));
  return out;
};

/** The project's lenses; without them, every synced project's lenses; without those, the built-ins. */
export async function lensesFor(d: D1Database, tag: string | null, now: number): Promise<string[]> {
  const projects = await db.listProjects(d, now - PROJECT_TTL_MS);
  const own = projects.find((p) => p.tag === (tag ?? ""));
  const names = own?.lenses.length ? own.lenses : [...new Set(projects.flatMap((p) => p.lenses))];
  const valid = names.filter((n) => TAG_NAME_RE.test(n));
  return (valid.length ? valid : DEFAULT_LENSES).slice(0, MAX_LENS_BUTTONS);
}

export function lensKeyboard(msgId: number, lenses: string[], picks: db.Picks, tag: string | null): Keyboard {
  const lensButtons = lenses.map((l) => ({ text: picks.lenses.includes(l) ? `✓ ${l}` : l, callback_data: `l:${msgId}:${l}` }));
  return {
    inline_keyboard: [
      ...rows(lensButtons, 3),
      [
        { text: picks.lenses.length ? "auto" : "✓ auto", callback_data: `a:${msgId}` },
        { text: picks.deep ? "✓ 🎞 frame by frame" : "🎞 frame by frame", callback_data: `d:${msgId}` },
      ],
      [{ text: `📁 ${tag ? `*${tag}` : "no project"} ▾`, callback_data: `p:${msgId}` }],
    ],
  };
}

export function projectKeyboard(msgId: number, tags: string[], current: string | null): Keyboard {
  const mark = (t: string | null) => (t === current ? "✓ " : "");
  const buttons = tags.map((t) => ({ text: `${mark(t)}*${t}`, callback_data: `t:${msgId}:${t}` }));
  return {
    inline_keyboard: [
      ...rows(buttons, 2),
      [
        { text: `${mark(null)}no project`, callback_data: `t:${msgId}:-` },
        { text: "« back", callback_data: `b:${msgId}` },
      ],
    ],
  };
}

export function stashedText(tag: string | null, waiting: number, extras = ""): string {
  return `✓ stashed${tag ? ` for *${tag}` : ""} · ${waiting} waiting${extras ? ` (${extras})` : ""}`;
}

export interface TgCallbackQuery {
  id: string;
  from: { id: number };
  data?: string;
  message?: { message_id: number; chat: { id: number } };
}

const DATA_RE = /^([ladpbt]):(\d{1,12})(?::([a-z0-9-]{1,32}))?$/;

/** A tap on one of the buttons. Only the owner's taps do anything; every tap is answered. */
export async function handleCallback(env: Env, cq: TgCallbackQuery, tg: TgClient, now: number): Promise<void> {
  const answer = (text?: string) => tg.call("answerCallbackQuery", { callback_query_id: cq.id, ...(text ? { text } : {}) });
  const owner = await db.getSetting(env.DB, "owner_id");
  const m = (cq.data ?? "").match(DATA_RE);
  if (!owner || owner !== String(cq.from.id) || !m || !cq.message) {
    await answer();
    return;
  }
  const [, action, idStr, arg] = m;
  const msgId = Number(idStr);
  const target = { chat_id: cq.message.chat.id, message_id: cq.message.message_id };
  const state = await db.waitingForMessage(env.DB, msgId);
  if (!state) {
    await tg.call("editMessageReplyMarkup", { ...target, reply_markup: { inline_keyboard: [] } });
    await answer("Already analyzed or removed.");
    return;
  }
  let { tag, picks } = state;
  const lenses = await lensesFor(env.DB, tag, now);

  if (action === "p") {
    const tags = (await db.listProjects(env.DB, now - PROJECT_TTL_MS))
      .map((p) => p.tag)
      .filter((t) => t && TAG_NAME_RE.test(t))
      .slice(0, MAX_PROJECT_BUTTONS);
    await tg.call("editMessageReplyMarkup", { ...target, reply_markup: projectKeyboard(msgId, tags, tag) });
    await answer(tags.length ? undefined : "No projects yet: name one in Claude Code first.");
    return;
  }
  if (action === "b") {
    await tg.call("editMessageReplyMarkup", { ...target, reply_markup: lensKeyboard(msgId, lenses, picks, tag) });
    await answer();
    return;
  }
  if (action === "t") {
    const next = arg === "-" || !arg ? null : arg;
    if (next !== null) {
      const known = (await db.listProjects(env.DB, now - PROJECT_TTL_MS)).some((p) => p.tag === next);
      if (!known) {
        await answer("Unknown project.");
        return;
      }
    }
    tag = next;
    await db.setTagForMessage(env.DB, msgId, tag, now);
    // The new project may have other lenses: keep only the picks it still offers.
    const nextLenses = await lensesFor(env.DB, tag, now);
    picks = { ...picks, lenses: picks.lenses.filter((l) => nextLenses.includes(l)) };
    await db.setPicks(env.DB, msgId, picks);
    const waiting = await db.countByStatus(env.DB, "waiting");
    await tg.call("editMessageText", { ...target, text: stashedText(tag, waiting), link_preview_options: { is_disabled: true }, reply_markup: lensKeyboard(msgId, nextLenses, picks, tag) });
    await answer(tag ? `Moved to *${tag}` : "No project");
    return;
  }

  if (action === "l") {
    if (!arg || !lenses.includes(arg)) {
      await answer("This lens isn't offered here.");
      return;
    }
    if (picks.lenses.includes(arg)) {
      picks = { ...picks, lenses: picks.lenses.filter((l) => l !== arg) };
    } else if (picks.lenses.length >= MAX_PICKS) {
      await answer(`Up to ${MAX_PICKS} lenses per link.`);
      return;
    } else {
      picks = { ...picks, lenses: [...picks.lenses, arg] };
    }
  } else if (action === "a") {
    picks = { ...picks, lenses: [] };
  } else if (action === "d") {
    picks = { ...picks, deep: !picks.deep };
  }
  await db.setPicks(env.DB, msgId, picks);
  await tg.call("editMessageReplyMarkup", { ...target, reply_markup: lensKeyboard(msgId, lenses, picks, tag) });
  await answer();
}
