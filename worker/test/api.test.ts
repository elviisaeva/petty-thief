// worker/test/api.test.ts
import { SELF, env } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sha256Hex } from "../src/auth";
import * as db from "../src/db";
import { API_PER_MINUTE, API_UNAUTH_PER_MINUTE } from "../src/api";

// Built at runtime so no token-shaped literal sits in the repo (see the pre-commit guard).
const TOKEN = "pt_" + "test".repeat(8);
const BASE = "https://pt.example.workers.dev";
const call = (path: string, init: RequestInit = {}, token = TOKEN) =>
  SELF.fetch(`${BASE}${path}`, { ...init, headers: { Authorization: `Bearer ${token}`, ...(init.headers ?? {}) } });

describe("api", () => {
  afterEach(() => vi.useRealTimers());

  beforeEach(async () => {
    await db.setSetting(env.DB, "api_token_hash", await sha256Hex(TOKEN));
  });

  it("rejects missing and wrong tokens", async () => {
    expect((await SELF.fetch(`${BASE}/api/count`)).status).toBe(401);
    expect((await call("/api/count", {}, "pt_wrong")).status).toBe(401);
  });

  it("rejects everything before a token exists", async () => {
    await db.deleteSettings(env.DB, "api_token_hash");
    expect((await call("/api/count")).status).toBe(401);
  });

  it("counts and lists waiting items oldest first", async () => {
    await db.addItem(env.DB, { url: "https://a.com/1", note: null, source: "other" }, 1);
    await db.addItem(env.DB, { url: "https://a.com/2", note: "deep", source: "other" }, 2);
    expect(await (await call("/api/count")).json()).toEqual({ waiting: 2 });
    const { items } = await (await call("/api/items")).json<{ items: db.Item[] }>();
    expect(items.map((i) => i.url)).toEqual(["https://a.com/1", "https://a.com/2"]);
    expect((await call("/api/items?status=bogus")).status).toBe(400);
  });

  it("filters count and items by tag, with or without untagged links", async () => {
    await db.addItem(env.DB, { url: "https://a.com/1", note: null, tag: "brand", source: "other" }, 1);
    await db.addItem(env.DB, { url: "https://a.com/2", note: null, tag: "home", source: "other" }, 2);
    await db.addItem(env.DB, { url: "https://a.com/3", note: null, source: "other" }, 3);
    const urls = async (q: string) => (await (await call(`/api/items${q}`)).json<{ items: db.Item[] }>()).items.map((i) => i.url);
    const count = async (q: string) => (await (await call(`/api/count${q}`)).json<{ waiting: number }>()).waiting;

    expect(await urls("")).toEqual(["https://a.com/1", "https://a.com/2", "https://a.com/3"]);
    expect(await count("")).toBe(3);
    expect(await urls("?untagged=0")).toHaveLength(3); // no tag: everything, as before
    expect(await urls("?tag=brand")).toEqual(["https://a.com/1", "https://a.com/3"]);
    expect(await count("?tag=brand")).toBe(2);
    expect(await urls("?tag=Brand&untagged=1")).toEqual(["https://a.com/1", "https://a.com/3"]);
    expect(await urls("?tag=brand&untagged=0")).toEqual(["https://a.com/1"]);
    expect(await count("?tag=brand&untagged=0")).toBe(1);
    expect(await count("?tag=nobody&untagged=0")).toBe(0);

    const { items } = await (await call("/api/items?tag=home&untagged=0")).json<{ items: db.Item[] }>();
    expect(items[0]).toMatchObject({ url: "https://a.com/2", tag: "home" });
    expect((await (await call("/api/items?tag=brand")).json<{ items: db.Item[] }>()).items[1].tag).toBeNull();
  });

  it("untagged=only gives only untagged links; by_tag=1 adds waiting counts per tag", async () => {
    await db.addItem(env.DB, { url: "https://a.com/1", note: null, tag: "brand", source: "other" }, 1);
    await db.addItem(env.DB, { url: "https://a.com/2", note: null, tag: "home", source: "other" }, 2);
    await db.addItem(env.DB, { url: "https://a.com/3", note: null, tag: "home", source: "other" }, 3);
    await db.addItem(env.DB, { url: "https://a.com/4", note: null, source: "other" }, 4);
    const { items } = await (await call("/api/items?untagged=only")).json<{ items: db.Item[] }>();
    expect(items.map((i) => i.url)).toEqual(["https://a.com/4"]);
    expect(await (await call("/api/count?untagged=only")).json()).toEqual({ waiting: 1 });
    expect(await (await call("/api/count?untagged=only&by_tag=1")).json()).toEqual({ waiting: 1, tagged: { brand: 1, home: 2 } });
    expect(await (await call("/api/count?tag=brand&by_tag=1")).json()).toEqual({ waiting: 2, tagged: { brand: 1, home: 2 } });
    expect(await (await call("/api/count?by_tag=0")).json()).toEqual({ waiting: 4 });
  });

  it("rejects a malformed tag, untagged or by_tag value", async () => {
    for (const q of ["tag=", "tag=-x", "tag=x-", "tag=a_b", `tag=${"a".repeat(33)}`, "tag=a%27b", "tag=brand&untagged=yes", "untagged=2", "tag=brand&untagged=only"]) {
      expect((await call(`/api/count?${q}`)).status, q).toBe(400);
      expect((await call(`/api/items?${q}`)).status, q).toBe(400);
    }
    expect((await call("/api/count?by_tag=yes")).status).toBe(400);
  });

  it("marks done with details, keeps Unicode, and clips long fields", async () => {
    const r = await db.addItem(env.DB, { url: "https://a.com/1", note: null, source: "other" }, 1);
    if (!r.added) throw new Error("expected added");
    const res = await call(`/api/items/${r.item.id}/done`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ lens: "creator", summary: `Хук "в лоб" ${"x".repeat(600)}`, file: "loot/a.md" }),
    });
    expect(res.status).toBe(200);
    const item = await db.getItem(env.DB, r.item.id);
    expect(item).toMatchObject({ status: "done", lens: "creator", file: "loot/a.md" });
    expect(item!.summary!.startsWith('Хук "в лоб"')).toBe(true);
    expect(item!.summary!.length).toBe(500);
    expect((await call(`/api/items/${r.item.id}/done`, { method: "POST" })).status).toBe(404);
  });

  it("skips with a reason and rejects bad bodies", async () => {
    const r = await db.addItem(env.DB, { url: "https://a.com/1", note: null, source: "other" }, 1);
    if (!r.added) throw new Error("expected added");
    expect((await call(`/api/items/${r.item.id}/skip`, { method: "POST", body: "{nope" })).status).toBe(400);
    expect((await call(`/api/items/${r.item.id}/skip`, { method: "POST", body: "x".repeat(17_000) })).status).toBe(413);
    expect((await call(`/api/items/${r.item.id}/skip`, { method: "POST", body: JSON.stringify({ reason: "dead link" }) })).status).toBe(200);
    expect(await db.getItem(env.DB, r.item.id)).toMatchObject({ status: "skipped", reason: "dead link" });
  });

  it("rate limits the owner per minute", async () => {
    vi.setSystemTime(Date.UTC(2026, 0, 1, 12, 0, 10));
    for (let i = 0; i < API_PER_MINUTE; i++) await call("/api/count");
    expect((await call("/api/count")).status).toBe(429);
  });

  it("caps unauthenticated requests separately and never locks the owner out", async () => {
    vi.setSystemTime(Date.UTC(2026, 0, 1, 12, 0, 10));
    const statuses: number[] = [];
    for (let i = 0; i < 200; i++) statuses.push((await call("/api/count", {}, "pt_bad")).status);
    expect(statuses.slice(0, API_UNAUTH_PER_MINUTE).every((s) => s === 401)).toBe(true);
    expect(statuses.slice(API_UNAUTH_PER_MINUTE).every((s) => s === 429)).toBe(true);
    expect((await call("/api/count")).status).toBe(200);
  });
});

describe("router", () => {
  it("answers on / and 404s elsewhere", async () => {
    expect(await (await SELF.fetch(`${BASE}/`)).text()).toContain("Petty Thief is running");
    expect((await SELF.fetch(`${BASE}/nope`)).status).toBe(404);
    expect((await SELF.fetch(`${BASE}/telegram`, { method: "POST", body: "{}" })).status).toBe(401);
  });
});
