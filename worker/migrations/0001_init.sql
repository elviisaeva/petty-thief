CREATE TABLE IF NOT EXISTS items (
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
  updated_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS items_waiting_url ON items (url) WHERE status = 'waiting';
CREATE INDEX IF NOT EXISTS items_status_created ON items (status, created_at);
CREATE INDEX IF NOT EXISTS items_status_updated ON items (status, updated_at);
CREATE INDEX IF NOT EXISTS items_tg_message ON items (tg_message_id);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS rate_limits (
  bucket TEXT PRIMARY KEY,
  n INTEGER NOT NULL
);
