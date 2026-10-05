import type { Env } from "./env";
import { newApiToken, safeEqual, sha256Hex } from "./auth";
import * as db from "./db";
import { applyBranding } from "./branding";
import { detectSource, extractLinks, extractTag, type Entity } from "./urls";
import { handleCallback, lensKeyboard, lensesFor, stashedText, type Keyboard, type TgCallbackQuery } from "./picker";

export interface TgClient {
  call(method: string, body: Record<string, unknown>): Promise<any>;
}

export interface TgMessage {
  message_id: number;
  from?: { id: number };
  chat: { id: number; type: string };
  text?: string;
  caption?: string;
  entities?: Entity[];
  caption_entities?: Entity[];
}

export interface TgUpdate {
  update_id: number;
  message?: TgMessage;
  callback_query?: TgCallbackQuery;
  [k: string]: unknown;
}

type Reply = (text: string, keyboard?: Keyboard) => Promise<unknown>;

export const DAILY_CAP = 200;

export const MAX_CLAIM_ATTEMPTS = 10;
const CLAIM_KEYS = ["claim_code_hash", "claim_expires", "claim_attempts"];

export const WELCOME = `Hey, petty thief here. 🦝
Send me anything worth stealing an idea from: a TikTok, a Reel, a repo, an article. Just share it here.
Then tap a lens under my reply, or leave it on auto. You can also type a note next to the link: "deep", "#recipes", "lens:design".
Next time you open Claude Code, it'll ask if you want to go through your stash.
/help shows everything I can do.`;

export const HELP = `Forward or paste any link here and I'll stash it for Claude Code.
Tap a lens under my reply to steer the analysis (up to 3), or 🎞 for frame by frame. Or type a note next to the link, for example "deep" or "lens:dev".
Add *project to send a link to one project, e.g. *brand

/list – what's waiting in your stash
/done – recently analyzed links
/undo – remove the last link
/connect – connect Claude Code (new key)
/rotate – key leaked? Get a new one (same as /connect)
/forget – delete everything
/help – how this works`;

export function connectMessage(origin: string, token: string): string {
  return `Paste this into Claude Code:\n\nConnect Petty Thief: ${origin} ${token}\n\nThis replaces any earlier connection. Delete this message after pasting.`;
}

export async function issueApiToken(d: D1Database): Promise<string> {
  const token = newApiToken();
  await db.setSetting(d, "api_token_hash", await sha256Hex(token));
  return token;
}

function startOfUtcDay(now: number): number {
  const d = new Date(now);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

async function claim(env: Env, fromId: number, code: string, reply: Reply, origin: string, now: number): Promise<void> {
  const d = env.DB;
  const hash = await db.getSetting(d, "claim_code_hash");
  if (!hash) return;
  const expiresStr = await db.getSetting(d, "claim_expires");
  if (!(now <= Number(expiresStr))) {
    await db.deleteSettings(d, ...CLAIM_KEYS);
    await reply("This code has expired. Open your /setup page again to get a new one.");
    return;
  }
  const attempts = await db.incrementSetting(d, "claim_attempts");
  if (!safeEqual(await sha256Hex(code.toUpperCase()), hash)) {
    if (attempts >= MAX_CLAIM_ATTEMPTS) {
      await db.deleteSettings(d, ...CLAIM_KEYS);
      await reply("Too many wrong codes. Open your /setup page again to get a new one.");
    } else {
      await reply("Wrong code.");
    }
    return;
  }
  if (attempts > MAX_CLAIM_ATTEMPTS) {
    return;
  }
  await db.setSetting(d, "owner_id", String(fromId));
  await db.deleteSettings(d, ...CLAIM_KEYS);
  const token = await issueApiToken(d);
  await reply("This bot is yours now. Nobody else can use it.");
  await reply(connectMessage(origin, token));
}

export async function handleUpdate(env: Env, update: TgUpdate, tg: TgClient, origin: string, now = Date.now()): Promise<void> {
  if (update.callback_query) {
    await handleCallback(env, update.callback_query, tg, now);
    return;
  }
  const msg = update.message;
  if (!msg?.from || msg.chat.type !== "private") return;
  const text = msg.text ?? msg.caption;
  if (text === undefined) return;
  const entities = msg.entities ?? msg.caption_entities;
  const reply: Reply = (t, keyboard) =>
    tg.call("sendMessage", { chat_id: msg.chat.id, text: t, link_preview_options: { is_disabled: true }, ...(keyboard ? { reply_markup: keyboard } : {}) });
  const cmd = text.trim().match(/^\/([a-z]+)(?:@\w+)?(?:\s+([\s\S]*))?$/i);

  const owner = await db.getSetting(env.DB, "owner_id");
  if (!owner) {
    const name = cmd?.[1].toLowerCase();
    if (name === "claim") await claim(env, msg.from.id, (cmd![2] ?? "").trim(), reply, origin, now);
    // Telegram's START button is the first thing a new user presses; silence would look broken.
    else if (name === "start" || name === "help") await reply("Send /claim <code> from your setup page.");
    return;
  }
  if (owner !== String(msg.from.id)) return;

  if (cmd) {
    await runCommand(env, cmd[1].toLowerCase(), (cmd[2] ?? "").trim(), reply, origin, tg);
    return;
  }
  await stash(env, msg, text, entities, reply, now);
}

async function runCommand(env: Env, name: string, arg: string, reply: Reply, origin: string, tg: TgClient): Promise<void> {
  const d = env.DB;
  if (name === "start") {
    await reply(WELCOME);
  } else if (name === "help") {
    await reply(HELP);
  } else if (name === "list") {
    const items = await db.listItems(d, "waiting", 10, true);
    const n = await db.countByStatus(d, "waiting");
    await reply(items.length ? `${n} waiting:\n${items.map((i) => `• ${i.url}${i.tag ? ` *${i.tag}` : ""}${i.note ? ` — ${i.note}` : ""}`).join("\n")}` : "Your stash is empty.");
  } else if (name === "done") {
    const items = await db.listItems(d, "done", 10, true);
    await reply(items.length ? `Recently analyzed:\n${items.map((i) => `• ${i.summary ?? "(no summary)"}\n  ${i.url}`).join("\n")}` : "Nothing analyzed yet.");
  } else if (name === "undo") {
    const item = await db.undoLast(d);
    await reply(item ? `Removed: ${item.url}` : "Nothing to undo.");
  } else if (name === "connect" || name === "rotate") {
    const message = connectMessage(origin, await issueApiToken(d));
    await applyBranding(tg);
    await reply(message);
  } else if (name === "forget") {
    if (arg.toLowerCase() === "yes") {
      await reply(`Deleted ${await db.forgetAll(d)} links.`);
    } else {
      const total = (await db.countByStatus(d, "waiting")) + (await db.countByStatus(d, "done")) + (await db.countByStatus(d, "skipped"));
      await reply(`This deletes all ${total} links, including the analyzed list. Send /forget yes to confirm.`);
    }
  } else if (name === "claim") {
    await reply("This bot already has an owner.");
  } else {
    await reply("Unknown command. Send /help to see what I can do.");
  }
}

async function stash(env: Env, msg: TgMessage, text: string, entities: Entity[] | undefined, reply: Reply, now: number): Promise<void> {
  // A Telegram retry of a message we already stored: stay silent, so one message gets one reply.
  // message_id is unique per chat, and this bot only talks in the owner's private chat.
  if (await db.hasTgMessage(env.DB, msg.message_id)) return;
  const links = extractLinks(text, entities);
  const urls = links.urls;
  const { tag, note } = extractTag(links.note);
  if (urls.length === 0) {
    await reply("No link found. Forward or paste a link.");
    return;
  }
  // The cap counts rows that still exist, so /undo and /forget give slots back. Fine for one owner.
  const today = await db.countCreatedSince(env.DB, startOfUtcDay(now));
  if (today + urls.length > DAILY_CAP) {
    await reply(`Daily limit of ${DAILY_CAP} links reached. Try again tomorrow.`);
    return;
  }
  let added = 0;
  let moved = 0;
  for (const url of urls) {
    const r = await db.addItem(env.DB, { url, note, tag, source: detectSource(url), tgMessageId: msg.message_id }, now);
    if (r.added) added++;
    else if (r.moved) moved++;
  }
  const already = urls.length - added - moved;
  if (added === 0 && moved === 0) {
    await reply(already === 1 ? "Already in your stash." : "All of these are already in your stash.");
    return;
  }
  if (added === 0) {
    await reply(`Moved to *${tag}${already ? ` (${already} already there)` : ""}`);
    return;
  }
  const extras = [moved ? `${moved} moved to *${tag}` : "", already ? `${already} already there` : ""].filter(Boolean).join(", ");
  const waiting = await db.countByStatus(env.DB, "waiting");
  const keyboard = lensKeyboard(msg.message_id, await lensesFor(env.DB, tag, now), { lenses: [], deep: false }, tag);
  await reply(stashedText(tag, waiting, extras), keyboard);
}
