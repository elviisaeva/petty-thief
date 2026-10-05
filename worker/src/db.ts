import { newId } from "./auth";

export type Status = "waiting" | "done" | "skipped";

export interface Item {
  id: string;
  url: string;
  note: string | null;
  source: string;
  status: Status;
  lens: string | null;
  summary: string | null;
  file: string | null;
  reason: string | null;
  tag: string | null;
  created_at: number;
  updated_at: number;
}

/** A row as stored: lenses and depth picked with the bot's buttons are kept apart from the note. */
interface ItemRow extends Item {
  pick_lenses: string | null;
  pick_deep: number;
}

export interface Picks {
  lenses: string[];
  deep: boolean;
}

/**
 * The note the skill reads: button picks first, in the same words the user could type
 * ("lens:design,creator deep"), then the user's own note. The pick columns are not returned.
 */
function toItem(row: ItemRow): Item {
  const { pick_lenses, pick_deep, ...item } = row;
  const parts = [pick_lenses ? `lens:${pick_lenses}` : "", pick_deep ? "deep" : "", item.note ?? ""].filter(Boolean);
  return { ...item, note: parts.length ? parts.join(" ") : null };
}

export interface NewItem {
  url: string;
  note: string | null;
  source: string;
  tag?: string | null;
  tgMessageId?: number;
}

/**
 * Which links a project takes. `{tag, untagged}`: those tagged for it, plus untagged ones when
 * `untagged` is true. `{untaggedOnly: true}`: only links without a tag (a project with no name).
 */
export type TagFilter = { tag: string; untagged: boolean } | { untaggedOnly: true };

function tagClause(filter?: TagFilter): { sql: string; args: unknown[] } {
  if (!filter) return { sql: "", args: [] };
  if ("untaggedOnly" in filter) return { sql: " AND tag IS NULL", args: [] };
  return filter.untagged ? { sql: " AND (tag = ? OR tag IS NULL)", args: [filter.tag] } : { sql: " AND tag = ?", args: [filter.tag] };
}

/** `moved`: the url was already waiting under another tag and now has the new one. */
export type AddResult = { added: true; item: Item } | { added: false; moved: boolean };

export interface DoneInfo {
  lens: string | null;
  summary: string | null;
  file: string | null;
}

const ITEM_COLUMNS = "id, url, note, source, status, lens, summary, file, reason, tag, created_at, updated_at, pick_lenses, pick_deep";

export async function getItem(db: D1Database, id: string): Promise<Item | null> {
  const row = await db.prepare(`SELECT ${ITEM_COLUMNS} FROM items WHERE id = ?`).bind(id).first<ItemRow>();
  return row ? toItem(row) : null;
}

export async function addItem(db: D1Database, input: NewItem, now = Date.now()): Promise<AddResult> {
  const dup = await db
    .prepare("SELECT id, tag FROM items WHERE url = ? AND status = 'waiting'")
    .bind(input.url)
    .first<{ id: string; tag: string | null }>();
  if (dup) {
    // Sent again with another tag: the link moves to that project. Dedupe stays per url.
    if (input.tag && input.tag !== dup.tag) {
      await db.prepare("UPDATE items SET tag = ?, updated_at = ? WHERE id = ?").bind(input.tag, now, dup.id).run();
      return { added: false, moved: true };
    }
    return { added: false, moved: false };
  }
  const id = newId(now);
  try {
    await db
      .prepare(
        "INSERT INTO items (id, url, note, source, status, tag, tg_message_id, created_at, updated_at) VALUES (?, ?, ?, ?, 'waiting', ?, ?, ?, ?)",
      )
      .bind(id, input.url, input.note, input.source, input.tag ?? null, input.tgMessageId ?? null, now, now)
      .run();
  } catch (e) {
    // Two deliveries of the same update can race past the check above.
    if (String(e).includes("UNIQUE")) return { added: false, moved: false };
    throw e;
  }
  const item = await getItem(db, id);
  if (!item) throw new Error("inserted item not found");
  return { added: true, item };
}

/** Telegram retries an update until it gets a 200. The message id tells a retry from a new message. */
export async function hasTgMessage(db: D1Database, tgMessageId: number): Promise<boolean> {
  return (await db.prepare("SELECT 1 FROM items WHERE tg_message_id = ? LIMIT 1").bind(tgMessageId).first()) !== null;
}

export async function countByStatus(db: D1Database, status: Status, filter?: TagFilter): Promise<number> {
  const t = tagClause(filter);
  const row = await db
    .prepare(`SELECT COUNT(*) AS n FROM items WHERE status = ?${t.sql}`)
    .bind(status, ...t.args)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

/** Waiting links per tag, for "2 links are tagged *home". Untagged links are not included. */
export async function countWaitingByTag(db: D1Database): Promise<Record<string, number>> {
  const { results } = await db
    .prepare("SELECT tag, COUNT(*) AS n FROM items WHERE status = 'waiting' AND tag IS NOT NULL GROUP BY tag ORDER BY tag")
    .all<{ tag: string; n: number }>();
  return Object.fromEntries(results.map((r) => [r.tag, r.n]));
}

export async function listItems(
  db: D1Database,
  status: Status,
  limit: number,
  newestFirst: boolean,
  filter?: TagFilter,
): Promise<Item[]> {
  const column = status === "waiting" ? "created_at" : "updated_at";
  const dir = newestFirst ? "DESC" : "ASC";
  const t = tagClause(filter);
  const { results } = await db
    .prepare(`SELECT ${ITEM_COLUMNS} FROM items WHERE status = ?${t.sql} ORDER BY ${column} ${dir}, id ${dir} LIMIT ?`)
    .bind(status, ...t.args, limit)
    .all<ItemRow>();
  return results.map(toItem);
}

export async function markDone(db: D1Database, id: string, info: DoneInfo, now = Date.now()): Promise<boolean> {
  const r = await db
    .prepare("UPDATE items SET status = 'done', lens = ?, summary = ?, file = ?, updated_at = ? WHERE id = ? AND status = 'waiting'")
    .bind(info.lens, info.summary, info.file, now, id)
    .run();
  return r.meta.changes === 1;
}

export async function markSkipped(db: D1Database, id: string, reason: string | null, now = Date.now()): Promise<boolean> {
  const r = await db
    .prepare("UPDATE items SET status = 'skipped', reason = ?, updated_at = ? WHERE id = ? AND status = 'waiting'")
    .bind(reason, now, id)
    .run();
  return r.meta.changes === 1;
}

export async function undoLast(db: D1Database): Promise<Item | null> {
  const last = await db
    .prepare(`SELECT ${ITEM_COLUMNS} FROM items WHERE status = 'waiting' ORDER BY created_at DESC, id DESC LIMIT 1`)
    .first<ItemRow>();
  if (!last) return null;
  await db.prepare("DELETE FROM items WHERE id = ?").bind(last.id).run();
  return toItem(last);
}

export async function forgetAll(db: D1Database): Promise<number> {
  const r = await db.prepare("DELETE FROM items").run();
  return r.meta.changes;
}

export async function countCreatedSince(db: D1Database, since: number): Promise<number> {
  const row = await db.prepare("SELECT COUNT(*) AS n FROM items WHERE created_at >= ?").bind(since).first<{ n: number }>();
  return row?.n ?? 0;
}

export async function getSetting(db: D1Database, key: string): Promise<string | null> {
  const row = await db.prepare("SELECT value FROM settings WHERE key = ?").bind(key).first<{ value: string }>();
  return row?.value ?? null;
}

export async function setSetting(db: D1Database, key: string, value: string): Promise<void> {
  await db
    .prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value")
    .bind(key, value)
    .run();
}

export async function deleteSettings(db: D1Database, ...keys: string[]): Promise<void> {
  for (const key of keys) await db.prepare("DELETE FROM settings WHERE key = ?").bind(key).run();
}

/** Atomically increment a numeric setting, defaulting to 1 if not present. Returns the new value. */
export async function incrementSetting(db: D1Database, key: string): Promise<number> {
  const row = await db
    .prepare("INSERT INTO settings (key, value) VALUES (?, '1') ON CONFLICT (key) DO UPDATE SET value = CAST(value AS INTEGER) + 1 RETURNING value")
    .bind(key)
    .first<{ value: string }>();
  return Number(row?.value ?? 1);
}

/**
 * Atomically takes a once-per-`ttl` lock stored as a timestamp setting. Returns true for exactly
 * one caller per window, even when several isolates ask at the same moment.
 */
export async function claimOnce(db: D1Database, key: string, now: number, ttl: number): Promise<boolean> {
  const row = await db
    .prepare(
      "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value WHERE CAST(settings.value AS INTEGER) <= ? OR CAST(settings.value AS INTEGER) > ? RETURNING value",
    )
    .bind(key, String(now), now - ttl, now)
    .first<{ value: string }>();
  return row !== null;
}

/** Counts a hit in `prefix:windowId`; returns false once the window has more than `max` hits. */
export async function hitRateLimit(db: D1Database, prefix: string, windowId: number, max: number): Promise<boolean> {
  const bucket = `${prefix}:${windowId}`;
  const row = await db
    .prepare("INSERT INTO rate_limits (bucket, n) VALUES (?, 1) ON CONFLICT (bucket) DO UPDATE SET n = n + 1 RETURNING n")
    .bind(bucket)
    .first<{ n: number }>();
  const n = row?.n ?? 1;
  if (n === 1) {
    await db.prepare("DELETE FROM rate_limits WHERE bucket LIKE ? AND bucket != ?").bind(`${prefix}:%`, bucket).run();
  }
  return n <= max;
}

/** The waiting links stored from one Telegram message: what a row of buttons acts on. */
export async function waitingForMessage(db: D1Database, tgMessageId: number): Promise<{ tag: string | null; picks: Picks } | null> {
  const row = await db
    .prepare("SELECT tag, pick_lenses, pick_deep FROM items WHERE tg_message_id = ? AND status = 'waiting' LIMIT 1")
    .bind(tgMessageId)
    .first<{ tag: string | null; pick_lenses: string | null; pick_deep: number }>();
  if (!row) return null;
  return { tag: row.tag, picks: { lenses: row.pick_lenses ? row.pick_lenses.split(",") : [], deep: row.pick_deep === 1 } };
}

export async function setPicks(db: D1Database, tgMessageId: number, picks: Picks): Promise<void> {
  await db
    .prepare("UPDATE items SET pick_lenses = ?, pick_deep = ? WHERE tg_message_id = ? AND status = 'waiting'")
    .bind(picks.lenses.length ? picks.lenses.join(",") : null, picks.deep ? 1 : 0, tgMessageId)
    .run();
}

export async function setTagForMessage(db: D1Database, tgMessageId: number, tag: string | null, now = Date.now()): Promise<void> {
  await db
    .prepare("UPDATE items SET tag = ?, updated_at = ? WHERE tg_message_id = ? AND status = 'waiting'")
    .bind(tag, now, tgMessageId)
    .run();
}

/** `tag` is '' for a project without one. */
export async function setProject(db: D1Database, tag: string, lenses: string[], now = Date.now()): Promise<void> {
  await db
    .prepare("INSERT INTO projects (tag, lenses, updated_at) VALUES (?, ?, ?) ON CONFLICT (tag) DO UPDATE SET lenses = excluded.lenses, updated_at = excluded.updated_at")
    .bind(tag, JSON.stringify(lenses), now)
    .run();
}

export interface Project {
  tag: string;
  lenses: string[];
}

/** Projects synced since `since`, newest first. */
export async function listProjects(db: D1Database, since: number): Promise<Project[]> {
  const { results } = await db
    .prepare("SELECT tag, lenses FROM projects WHERE updated_at >= ? ORDER BY updated_at DESC LIMIT 20")
    .bind(since)
    .all<{ tag: string; lenses: string }>();
  return results.map((r) => {
    let lenses: unknown = [];
    try {
      lenses = JSON.parse(r.lenses);
    } catch {
      lenses = [];
    }
    return { tag: r.tag, lenses: Array.isArray(lenses) ? lenses.filter((l): l is string => typeof l === "string") : [] };
  });
}
