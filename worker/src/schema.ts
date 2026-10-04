// worker/src/schema.ts
// migrations/0001_init.sql is frozen. Columns added later live only here, in ADDED_COLUMNS
// (and last in the CREATE TABLE below), so every database gets them through ensureSchema.
// The Deploy-to-Cloudflare flow may deploy without applying migrations, so the worker
// creates missing tables itself on the first request of each isolate.
export const SCHEMA: string[] = [
  `CREATE TABLE IF NOT EXISTS items (
  id TEXT PRIMARY KEY,
  url TEXT NOT NULL,
  note TEXT,
  source TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'waiting' CHECK (status IN ('waiting', 'done', 'skipped')),
  lens TEXT,
  summary TEXT,
  file TEXT,
  reason TEXT,
  tg_message_id INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  tag TEXT
)`,
  "CREATE UNIQUE INDEX IF NOT EXISTS items_waiting_url ON items (url) WHERE status = 'waiting'",
  "CREATE INDEX IF NOT EXISTS items_status_created ON items (status, created_at)",
  "CREATE INDEX IF NOT EXISTS items_status_updated ON items (status, updated_at)",
  "CREATE INDEX IF NOT EXISTS items_tg_message ON items (tg_message_id)",
  "CREATE INDEX IF NOT EXISTS items_status_tag ON items (status, tag, created_at)",
  "CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)",
  "CREATE TABLE IF NOT EXISTS rate_limits (bucket TEXT PRIMARY KEY, n INTEGER NOT NULL)",
];

let ready = false;

// Columns added after 0001_init.sql. SQLite has no ADD COLUMN IF NOT EXISTS, so ensureSchema
// checks the table first. Each one also sits in the CREATE TABLE above, last, in this order.
export const ADDED_COLUMNS: { name: string; sql: string }[] = [{ name: "tag", sql: "ALTER TABLE items ADD COLUMN tag TEXT" }];

/** Creates any missing table, column or index. Cheap: two queries per isolate, then a no-op. */
export async function ensureSchema(db: D1Database): Promise<void> {
  if (ready) return;
  // An items table from an older deploy lacks the newer columns; add them before any index uses them.
  const { results } = await db.prepare("PRAGMA table_info(items)").all<{ name: string }>();
  if (results.length > 0) {
    const have = new Set(results.map((c) => c.name));
    for (const c of ADDED_COLUMNS) {
      if (have.has(c.name)) continue;
      try {
        await db.prepare(c.sql).run();
      } catch (e) {
        // Another isolate may have added it a moment ago.
        if (!/duplicate column/i.test(String(e))) throw e;
      }
    }
  }
  await db.batch(SCHEMA.map((sql) => db.prepare(sql)));
  ready = true;
}

/** Tests only. */
export function resetSchemaMemo(): void {
  ready = false;
}
