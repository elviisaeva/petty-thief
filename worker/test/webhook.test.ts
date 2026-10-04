// worker/test/webhook.test.ts
import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { sha256Hex } from "../src/auth";
import * as db from "../src/db";
import { handleWebhook } from "../src/webhook";
import { ORIGIN, fakeTg, msg, seedOwner } from "./helpers";

const SECRET = "s3cret_value";

function post(body: string, secret?: string): Request {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (secret !== undefined) headers["X-Telegram-Bot-Api-Secret-Token"] = secret;
  return new Request(`${ORIGIN}/telegram`, { method: "POST", headers, body });
}

describe("webhook", () => {
  beforeEach(async () => {
    await seedOwner(env.DB);
    await db.setSetting(env.DB, "webhook_secret_hash", await sha256Hex(SECRET));
  });

  it("rejects requests without the right secret", async () => {
    const tg = fakeTg();
    expect((await handleWebhook(post(JSON.stringify(msg("https://a.com/1"))), env, tg.client)).status).toBe(401);
    expect((await handleWebhook(post(JSON.stringify(msg("https://a.com/1")), "wrong"), env, tg.client)).status).toBe(401);
    expect(await db.countByStatus(env.DB, "waiting")).toBe(0);
  });

  it("rejects everything before setup stored a secret", async () => {
    await db.deleteSettings(env.DB, "webhook_secret_hash");
    expect((await handleWebhook(post("{}", ""), env, fakeTg().client)).status).toBe(401);
  });

  it("stashes a valid update and answers 200", async () => {
    const tg = fakeTg();
    const res = await handleWebhook(post(JSON.stringify(msg("https://a.com/1")), SECRET), env, tg.client);
    expect(res.status).toBe(200);
    expect(await db.countByStatus(env.DB, "waiting")).toBe(1);
  });

  it("ignores oversized and malformed bodies with 200 so Telegram stops retrying", async () => {
    const tg = fakeTg();
    const big = JSON.stringify(msg(`https://a.com/1 ${"x".repeat(17_000)}`));
    expect((await handleWebhook(post(big, SECRET), env, tg.client)).status).toBe(200);
    expect((await handleWebhook(post("not json", SECRET), env, tg.client)).status).toBe(200);
    expect(await db.countByStatus(env.DB, "waiting")).toBe(0);
  });

  it("answers 200 even when Telegram's sendMessage throws", async () => {
    const client = { call: async () => { throw new Error("telegram down"); } };
    expect((await handleWebhook(post(JSON.stringify(msg("https://a.com/1")), SECRET), env, client)).status).toBe(200);
  });
});
