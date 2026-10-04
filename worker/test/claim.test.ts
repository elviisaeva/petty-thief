import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { sha256Hex } from "../src/auth";
import * as db from "../src/db";
import { MAX_CLAIM_ATTEMPTS, handleUpdate } from "../src/telegram";
import { ORIGIN, OWNER, fakeTg, msg } from "./helpers";

const NOW = 1_000_000;

async function seedCode(code = "ABC234", expires = NOW + 60_000) {
  await db.setSetting(env.DB, "claim_code_hash", await sha256Hex(code));
  await db.setSetting(env.DB, "claim_expires", String(expires));
  await db.setSetting(env.DB, "claim_attempts", "0");
}

describe("claim", () => {
  beforeEach(() => seedCode());

  it("makes the sender the owner and sends the connection message", async () => {
    const tg = fakeTg();
    await handleUpdate(env, msg("/claim abc234"), tg.client, ORIGIN, NOW);
    expect(await db.getSetting(env.DB, "owner_id")).toBe(String(OWNER));
    expect(await db.getSetting(env.DB, "claim_code_hash")).toBeNull();
    expect(await db.getSetting(env.DB, "api_token_hash")).toMatch(/^[0-9a-f]{64}$/);
    const sent = tg.sent();
    expect(sent[0]).toBe("This bot is yours now. Nobody else can use it.");
    expect(sent[1]).toContain(`Connect Petty Thief: ${ORIGIN} pt_`);
  });

  it("rejects a wrong code and counts attempts", async () => {
    const tg = fakeTg();
    await handleUpdate(env, msg("/claim ZZZZZZ"), tg.client, ORIGIN, NOW);
    expect(tg.sent()).toEqual(["Wrong code."]);
    expect(await db.getSetting(env.DB, "owner_id")).toBeNull();
    expect(await db.getSetting(env.DB, "claim_attempts")).toBe("1");
  });

  it("burns the code after too many wrong attempts", async () => {
    const tg = fakeTg();
    for (let i = 0; i < MAX_CLAIM_ATTEMPTS; i++) await handleUpdate(env, msg("/claim ZZZZZZ", { from: 7 }), tg.client, ORIGIN, NOW);
    expect(tg.sent().at(-1)).toBe("Too many wrong codes. Open your /setup page again to get a new one.");
    expect(await db.getSetting(env.DB, "claim_attempts")).toBeNull();
    expect(await db.getSetting(env.DB, "claim_code_hash")).toBeNull();
    await handleUpdate(env, msg("/claim ABC234"), tg.client, ORIGIN, NOW);
    expect(await db.getSetting(env.DB, "owner_id")).toBeNull();
  });

  it("refuses an expired code", async () => {
    const tg = fakeTg();
    await handleUpdate(env, msg("/claim ABC234"), tg.client, ORIGIN, NOW + 120_000);
    expect(tg.sent()).toEqual(["This code has expired. Open your /setup page again to get a new one."]);
    expect(await db.getSetting(env.DB, "owner_id")).toBeNull();
  });

  it("stays silent to everything else before setup made a code", async () => {
    await db.deleteSettings(env.DB, "claim_code_hash", "claim_expires", "claim_attempts");
    const tg = fakeTg();
    await handleUpdate(env, msg("/claim ABC234"), tg.client, ORIGIN, NOW);
    await handleUpdate(env, msg("https://a.com/1"), tg.client, ORIGIN, NOW);
    expect(tg.calls).toEqual([]);
  });

  it("answers /start and /help before the bot is claimed, and nothing else", async () => {
    const tg = fakeTg();
    await handleUpdate(env, msg("/start"), tg.client, ORIGIN, NOW);
    await handleUpdate(env, msg("/help@my_petty_thief_bot", { from: 7 }), tg.client, ORIGIN, NOW);
    await handleUpdate(env, msg("/list"), tg.client, ORIGIN, NOW);
    await handleUpdate(env, msg("https://a.com/1"), tg.client, ORIGIN, NOW);
    await handleUpdate(env, msg("/start", { chatType: "group" }), tg.client, ORIGIN, NOW);
    expect(tg.sent()).toEqual(["Send /claim <code> from your setup page.", "Send /claim <code> from your setup page."]);
    expect(await db.getSetting(env.DB, "owner_id")).toBeNull();
  });
});
