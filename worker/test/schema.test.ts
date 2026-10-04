import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { ADDED_COLUMNS, SCHEMA, ensureSchema, resetSchemaMemo } from "../src/schema";

const TABLES = ["items", "rate_limits", "settings"];

async function shape(): Promise<Record<string, unknown>> {
  const out: Record<string, unknown> = {};
  for (const t of TABLES) {
    const { results } = await env.DB.prepare(`PRAGMA table_info(${t})`).all();
    out[t] = results;
  }
  const { results: idx } = await env.DB.prepare(
    "SELECT name, tbl_name FROM sqlite_master WHERE type = 'index' AND sql IS NOT NULL ORDER BY name",
  ).all();
  out.indexes = idx;
  return out;
}

async function dropAll(): Promise<void> {
  for (const t of TABLES) await env.DB.prepare(`DROP TABLE IF EXISTS ${t}`).run();
}

describe("schema", () => {
  beforeEach(() => resetSchemaMemo());

  it("creates the three tables", async () => {
    const { results } = await env.DB.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('items', 'settings', 'rate_limits') ORDER BY name",
    ).all<{ name: string }>();
    expect(results.map((r) => r.name)).toEqual(TABLES);
  });

  it("allows one waiting row per url but repeats once it is done", async () => {
    const ins = "INSERT INTO items (id, url, source, status, created_at, updated_at) VALUES (?, 'https://a.com/', 'other', ?, 1, 1)";
    await env.DB.prepare(ins).bind("a", "waiting").run();
    await expect(env.DB.prepare(ins).bind("b", "waiting").run()).rejects.toThrow(/UNIQUE/);
    await env.DB.prepare(ins).bind("c", "done").run();
  });

  it("ensureSchema is idempotent on a migrated database and keeps the data", async () => {
    await env.DB.prepare("INSERT INTO settings (key, value) VALUES ('k', 'v')").run();
    await ensureSchema(env.DB);
    resetSchemaMemo();
    await ensureSchema(env.DB);
    expect(await env.DB.prepare("SELECT value FROM settings WHERE key = 'k'").first("value")).toBe("v");
  });

  it("recreates dropped tables, with exactly the migration's columns and indexes", async () => {
    const fromMigration = await shape();
    await dropAll();
    await ensureSchema(env.DB);
    expect(await shape()).toEqual(fromMigration);
  });

  it("migrations stop at 0001: later columns come only from ensureSchema", () => {
    expect(env.TEST_MIGRATIONS.map((m) => m.name)).toEqual(["0001_init.sql"]);
    const sql = env.TEST_MIGRATIONS[0].queries.join("\n");
    for (const c of ADDED_COLUMNS) expect(sql).not.toMatch(new RegExp(`\\b${c.name}\\b`));
  });

  it("a pre-tags database (0001 only) gets the added columns, the same shape as a fresh one, and keeps its rows", async () => {
    await dropAll();
    await ensureSchema(env.DB);
    const fresh = await shape();
    await dropAll();
    // Exactly what a live database deployed before tags has: 0001_init.sql and nothing else.
    for (const q of env.TEST_MIGRATIONS[0].queries) await env.DB.prepare(q).run();
    const before = await env.DB.prepare("PRAGMA table_info(items)").all<{ name: string }>();
    expect(before.results.map((r) => r.name)).not.toContain("tag");
    await env.DB.prepare("INSERT INTO items (id, url, source, created_at, updated_at) VALUES ('old', 'https://a.com/', 'other', 1, 1)").run();
    resetSchemaMemo();
    await ensureSchema(env.DB);
    expect(await shape()).toEqual(fresh);
    expect(await env.DB.prepare("SELECT url, tag FROM items WHERE id = 'old'").first()).toEqual({ url: "https://a.com/", tag: null });
  });

  it("runs only once per isolate", async () => {
    await ensureSchema(env.DB);
    await dropAll();
    await ensureSchema(env.DB); // memoized: does nothing
    const { results } = await env.DB.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'items'").all();
    expect(results).toEqual([]);
  });

  it("uses IF NOT EXISTS in every statement", () => {
    for (const s of SCHEMA) expect(s).toMatch(/^CREATE (UNIQUE )?(TABLE|INDEX) IF NOT EXISTS /);
    for (const c of ADDED_COLUMNS) expect(c.sql).toBe(`ALTER TABLE items ADD COLUMN ${c.name} TEXT`);
  });
});
