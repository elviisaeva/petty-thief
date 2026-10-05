// worker/test/setup.test.ts
import { env } from "cloudflare:test";
import { afterEach, describe, expect, it, vi } from "vitest";
import { sha256Hex } from "../src/auth";
import * as db from "../src/db";
import { resetSchemaMemo } from "../src/schema";
import { CLAIM_TTL_MS, handleSetup } from "../src/setup";
import { telegramClient } from "../src/telegram-client";
import type { TgClient } from "../src/telegram";
import { ORIGIN, fakeTg, seedOwner } from "./helpers";

const NOW = 5_000_000;
const form = (token: string) =>
  new Request(`${ORIGIN}/setup`, { method: "POST", body: new URLSearchParams({ token }) });

describe("setup", () => {
  it("shows a form on GET without leaking anything", async () => {
    const res = await handleSetup(new Request(`${ORIGIN}/setup`), env, fakeTg().client, NOW);
    const html = await res.text();
    expect(res.status).toBe(200);
    expect(html).toContain('type="password"');
    expect(html).not.toContain("123:TEST");
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("refuses a wrong token and touches nothing", async () => {
    const tg = fakeTg();
    const res = await handleSetup(form("999:WRONG"), env, tg.client, NOW);
    expect(res.status).toBe(403);
    expect(await res.text()).toContain("match the one saved in Cloudflare");
    expect(tg.calls).toEqual([]);
  });

  it("registers the webhook, stores only hashes, and shows a claim code", async () => {
    const tg = fakeTg({ setWebhook: { ok: true, result: true }, getMe: { ok: true, result: { username: "my_petty_thief_bot" } } });
    const res = await handleSetup(form(" 123:TEST "), env, tg.client, NOW);
    const html = await res.text();
    expect(res.status).toBe(200);

    const hook = tg.calls.find((c) => c.method === "setWebhook")!.body;
    expect(hook.url).toBe(`${ORIGIN}/telegram`);
    expect(hook.allowed_updates).toEqual(["message", "callback_query"]);
    expect(await db.getSetting(env.DB, "webhook_updates")).toBe("message,callback_query");
    expect(tg.calls.some((c) => c.method === "setMyCommands")).toBe(true);
    expect(await db.getSetting(env.DB, "webhook_secret_hash")).toBe(await sha256Hex(hook.secret_token));

    const code = html.match(/\/claim ([A-Z2-9]{6})/)![1];
    expect(html).toContain("@my_petty_thief_bot");
    expect(await db.getSetting(env.DB, "claim_code_hash")).toBe(await sha256Hex(code));
    expect(await db.getSetting(env.DB, "claim_expires")).toBe(String(NOW + CLAIM_TTL_MS));
  });

  it("shows Telegram's error when the webhook is refused, and keeps the old secret hash", async () => {
    await db.setSetting(env.DB, "webhook_secret_hash", "previous-hash");
    const tg = fakeTg({ setWebhook: { ok: false, description: "Unauthorized <bad>" } });
    const res = await handleSetup(form("123:TEST"), env, tg.client, NOW);
    expect(res.status).toBe(502);
    expect(await res.text()).toContain("Unauthorized &lt;bad&gt;");
    expect(await db.getSetting(env.DB, "webhook_secret_hash")).toBe("previous-hash");
    expect(await db.getSetting(env.DB, "claim_code_hash")).toBeNull();
  });

  it("explains a missing BOT_TOKEN secret, separately from a mismatch", async () => {
    const noToken = { ...env, BOT_TOKEN: "" };
    for (const req of [new Request(`${ORIGIN}/setup`), form("123:TEST")]) {
      const tg = fakeTg();
      const res = await handleSetup(req, noToken, tg.client, NOW);
      expect(res.status).toBe(500);
      expect(await res.text()).toContain("Cloudflare has no BOT_TOKEN secret yet.");
      expect(tg.calls).toEqual([]);
    }
  });

  it("creates missing tables before doing anything", async () => {
    resetSchemaMemo();
    await env.DB.prepare("DROP TABLE settings").run();
    const res = await handleSetup(new Request(`${ORIGIN}/setup`), env, fakeTg().client, NOW);
    expect(res.status).toBe(200);
  });

  it("locks itself once the bot has an owner", async () => {
    await seedOwner(env.DB);
    const tg = fakeTg();
    expect((await handleSetup(new Request(`${ORIGIN}/setup`), env, tg.client, NOW)).status).toBe(410);
    expect((await handleSetup(form("123:TEST"), env, tg.client, NOW)).status).toBe(410);
    expect(tg.calls).toEqual([]);
  });

  it("limits attempts per minute", async () => {
    const tg = fakeTg();
    for (let i = 0; i < 10; i++) await handleSetup(form("999:WRONG"), env, tg.client, NOW);
    expect((await handleSetup(form("123:TEST"), env, tg.client, NOW)).status).toBe(429);
  });

  it("answers a malformed form with the friendly page, not a 500", async () => {
    const tg = fakeTg();
    const bad = new Request(`${ORIGIN}/setup`, { method: "POST", headers: { "content-type": "multipart/form-data; boundary=x" }, body: "not multipart" });
    const res = await handleSetup(bad, env, tg.client, NOW);
    expect(res.status).toBe(400);
    expect(await res.text()).toContain("didn&#39;t come through");
    expect(tg.calls).toEqual([]);
  });

  it("shows the Telegram page when setWebhook throws, and stores nothing", async () => {
    const throwing: TgClient = { async call() { throw new Error("network down"); } };
    const res = await handleSetup(form("123:TEST"), env, throwing, NOW);
    expect(res.status).toBe(502);
    expect(await res.text()).toContain("Couldn't reach Telegram");
    expect(await db.getSetting(env.DB, "webhook_secret_hash")).toBeNull();
    expect(await db.getSetting(env.DB, "claim_code_hash")).toBeNull();
  });

  it("still shows a claim code when only getMe throws", async () => {
    const client: TgClient = {
      async call(method) {
        if (method === "getMe") throw new Error("network down");
        return { ok: true, result: true };
      },
    };
    const res = await handleSetup(form("123:TEST"), env, client, NOW);
    const html = await res.text();
    expect(res.status).toBe(200);
    expect(html).toContain("your bot");
    expect(html).toMatch(/\/claim [A-Z2-9]{6}/);
  });

  it("accepts the right token when the Cloudflare secret has stray whitespace", async () => {
    const padded = { ...env, BOT_TOKEN: " 123:TEST\n" };
    const res = await handleSetup(form("123:TEST"), padded, fakeTg().client, NOW);
    expect(res.status).toBe(200);
  });
});

describe("telegramClient", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("turns a fetch throw into an ok:false answer", async () => {
    vi.stubGlobal("fetch", async () => { throw new TypeError("fetch failed"); });
    const r = await telegramClient("123:TEST").call("getMe", {});
    expect(r).toEqual({ ok: false, description: "couldn't reach Telegram" });
  });

  it("turns a non-JSON body into an ok:false answer", async () => {
    vi.stubGlobal("fetch", async () => new Response("<html>bad gateway</html>", { status: 502 }));
    expect(await telegramClient("123:TEST").call("getMe", {})).toEqual({ ok: false, description: "HTTP 502" });
  });

  it("trims the token before building the API URL", async () => {
    let seen = "";
    vi.stubGlobal("fetch", async (url: string) => { seen = String(url); return Response.json({ ok: true }); });
    await telegramClient(" 123:TEST\n").call("getMe", {});
    expect(seen).toBe("https://api.telegram.org/bot123:TEST/getMe");
  });
});
