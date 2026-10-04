import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import * as db from "../src/db";

const add = (url: string, now: number, note: string | null = null) =>
  db.addItem(env.DB, { url, note, source: "other" }, now);

describe("items", () => {
  it("adds an item and refuses a duplicate while it waits", async () => {
    const first = await add("https://a.com/1", 1000, "deep");
    expect(first.added).toBe(true);
    if (first.added) expect(first.item).toMatchObject({ url: "https://a.com/1", note: "deep", status: "waiting", created_at: 1000 });
    expect((await add("https://a.com/1", 2000)).added).toBe(false);
    expect(await db.countByStatus(env.DB, "waiting")).toBe(1);
  });

  it("allows the same url again once the first one is done", async () => {
    const r = await add("https://a.com/1", 1000);
    if (!r.added) throw new Error("expected added");
    expect(await db.markDone(env.DB, r.item.id, { lens: "creator", summary: "Hook in 1s", file: "x.md" }, 1500)).toBe(true);
    expect((await add("https://a.com/1", 2000)).added).toBe(true);
  });

  it("remembers which Telegram message an item came from", async () => {
    expect(await db.hasTgMessage(env.DB, 77)).toBe(false);
    await db.addItem(env.DB, { url: "https://a.com/1", note: null, source: "other", tgMessageId: 77 }, 1000);
    expect(await db.hasTgMessage(env.DB, 77)).toBe(true);
    expect(await db.hasTgMessage(env.DB, 78)).toBe(false);
  });

  it("lists waiting oldest first or newest first", async () => {
    await add("https://a.com/1", 1000);
    await add("https://a.com/2", 2000);
    await add("https://a.com/3", 3000);
    expect((await db.listItems(env.DB, "waiting", 10, false)).map((i) => i.url)).toEqual([
      "https://a.com/1", "https://a.com/2", "https://a.com/3",
    ]);
    expect((await db.listItems(env.DB, "waiting", 2, true)).map((i) => i.url)).toEqual(["https://a.com/3", "https://a.com/2"]);
  });

  it("marks done or skipped only while waiting, and stores the details", async () => {
    const r = await add("https://a.com/1", 1000);
    if (!r.added) throw new Error("expected added");
    expect(await db.markSkipped(env.DB, r.item.id, "dead link", 1100)).toBe(true);
    expect(await db.markDone(env.DB, r.item.id, { lens: null, summary: null, file: null }, 1200)).toBe(false);
    expect(await db.getItem(env.DB, r.item.id)).toMatchObject({ status: "skipped", reason: "dead link", updated_at: 1100 });
    expect(await db.markDone(env.DB, "nope", { lens: null, summary: null, file: null })).toBe(false);
  });

  it("lists done items by when they were analyzed", async () => {
    const a = await add("https://a.com/1", 1000);
    const b = await add("https://a.com/2", 2000);
    if (!a.added || !b.added) throw new Error("expected added");
    await db.markDone(env.DB, b.item.id, { lens: "dev", summary: "B", file: null }, 3000);
    await db.markDone(env.DB, a.item.id, { lens: "dev", summary: "A", file: null }, 4000);
    expect((await db.listItems(env.DB, "done", 10, true)).map((i) => i.summary)).toEqual(["A", "B"]);
  });

  it("undoes the newest waiting item", async () => {
    await add("https://a.com/1", 1000);
    await add("https://a.com/2", 2000);
    expect((await db.undoLast(env.DB))?.url).toBe("https://a.com/2");
    expect(await db.countByStatus(env.DB, "waiting")).toBe(1);
    await db.undoLast(env.DB);
    expect(await db.undoLast(env.DB)).toBeNull();
  });

  it("forgets everything and counts what was created since a time", async () => {
    await add("https://a.com/1", 1000);
    await add("https://a.com/2", 5000);
    expect(await db.countCreatedSince(env.DB, 2000)).toBe(1);
    expect(await db.forgetAll(env.DB)).toBe(2);
    expect(await db.countByStatus(env.DB, "waiting")).toBe(0);
  });
});

describe("settings", () => {
  it("sets, overwrites, reads and deletes", async () => {
    expect(await db.getSetting(env.DB, "owner_id")).toBeNull();
    await db.setSetting(env.DB, "owner_id", "1");
    await db.setSetting(env.DB, "owner_id", "2");
    await db.setSetting(env.DB, "other", "x");
    expect(await db.getSetting(env.DB, "owner_id")).toBe("2");
    await db.deleteSettings(env.DB, "owner_id", "other");
    expect(await db.getSetting(env.DB, "owner_id")).toBeNull();
    expect(await db.getSetting(env.DB, "other")).toBeNull();
  });

  it("atomically increments a numeric setting, defaulting to 1", async () => {
    expect(await db.incrementSetting(env.DB, "counter")).toBe(1);
    expect(await db.getSetting(env.DB, "counter")).toBe("1");
    expect(await db.incrementSetting(env.DB, "counter")).toBe(2);
    expect(await db.incrementSetting(env.DB, "counter")).toBe(3);
    expect(await db.getSetting(env.DB, "counter")).toBe("3");
  });
});

describe("rate limit", () => {
  it("allows max hits per window, then blocks, and a new window starts fresh", async () => {
    for (let i = 0; i < 3; i++) expect(await db.hitRateLimit(env.DB, "api", 7, 3)).toBe(true);
    expect(await db.hitRateLimit(env.DB, "api", 7, 3)).toBe(false);
    expect(await db.hitRateLimit(env.DB, "api", 8, 3)).toBe(true);
    const { results } = await env.DB.prepare("SELECT bucket FROM rate_limits").all<{ bucket: string }>();
    expect(results.map((r) => r.bucket)).toEqual(["api:8"]);
  });
});
