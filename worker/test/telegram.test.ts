import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import * as db from "../src/db";
import { DAILY_CAP, HELP, WELCOME, handleUpdate } from "../src/telegram";
import { ORIGIN, OWNER, fakeTg, msg, seedOwner } from "./helpers";

const NOW = Date.UTC(2026, 9, 3, 12);

describe("stashing", () => {
  beforeEach(() => seedOwner(env.DB));

  it("stashes a link with its note and replies with the count", async () => {
    const tg = fakeTg();
    await handleUpdate(env, msg("deep https://vt.tiktok.com/ZS1/"), tg.client, ORIGIN, NOW);
    expect(tg.sent()).toEqual(["✓ stashed · 1 waiting"]);
    const [item] = await db.listItems(env.DB, "waiting", 10, false);
    expect(item).toMatchObject({ url: "https://vt.tiktok.com/ZS1/", note: "deep", source: "tiktok" });
  });

  it("reads links from photo or video captions", async () => {
    const tg = fakeTg();
    await handleUpdate(env, msg("https://www.instagram.com/p/X/", { caption: true }), tg.client, ORIGIN, NOW);
    expect(tg.sent()).toEqual(["✓ stashed · 1 waiting"]);
  });

  it("stores and answers the same update only once when Telegram retries", async () => {
    const tg = fakeTg();
    const update = msg("https://x.com/a/status/1");
    await handleUpdate(env, update, tg.client, ORIGIN, NOW);
    await handleUpdate(env, update, tg.client, ORIGIN, NOW);
    expect(await db.countByStatus(env.DB, "waiting")).toBe(1);
    expect(tg.sent()).toEqual(["✓ stashed · 1 waiting"]);
  });

  it("still answers a new message with an already-stashed link", async () => {
    const tg = fakeTg();
    await handleUpdate(env, msg("https://x.com/a/status/1"), tg.client, ORIGIN, NOW);
    await handleUpdate(env, msg("https://x.com/a/status/1"), tg.client, ORIGIN, NOW);
    expect(tg.sent()).toEqual(["✓ stashed · 1 waiting", "Already in your stash."]);
  });

  it("reports partly duplicated messages", async () => {
    const tg = fakeTg();
    await handleUpdate(env, msg("https://a.com/1"), tg.client, ORIGIN, NOW);
    await handleUpdate(env, msg("https://a.com/1 https://a.com/2"), tg.client, ORIGIN, NOW);
    expect(tg.sent()[1]).toBe("✓ stashed · 2 waiting (1 already there)");
  });

  it("stores a project tag, removes it from the note and names it in the reply", async () => {
    const tg = fakeTg();
    await handleUpdate(env, msg("*Brand deep https://vt.tiktok.com/ZS1/"), tg.client, ORIGIN, NOW);
    await handleUpdate(env, msg("https://a.com/2"), tg.client, ORIGIN, NOW + 1);
    expect(tg.sent()).toEqual(["✓ stashed for *brand · 1 waiting", "✓ stashed · 2 waiting"]);
    const items = await db.listItems(env.DB, "waiting", 10, false);
    expect(items.map((i) => [i.url, i.tag, i.note])).toEqual([
      ["https://vt.tiktok.com/ZS1/", "brand", "deep"],
      ["https://a.com/2", null, null],
    ]);
  });

  it("does not read **bold** or a star inside a link as a tag", async () => {
    const tg = fakeTg();
    await handleUpdate(env, msg("**bold** https://a.com/x*brand"), tg.client, ORIGIN, NOW);
    expect(tg.sent()).toEqual(["✓ stashed · 1 waiting"]);
    const [item] = await db.listItems(env.DB, "waiting", 10, false);
    expect(item).toMatchObject({ url: "https://a.com/x*brand", tag: null, note: "**bold**" });
  });

  it("keeps dedupe per url; a waiting link sent again with another tag moves to it", async () => {
    const tg = fakeTg();
    await handleUpdate(env, msg("https://a.com/1 *brand"), tg.client, ORIGIN, NOW);
    await handleUpdate(env, msg("https://a.com/1 *brand"), tg.client, ORIGIN, NOW);
    await handleUpdate(env, msg("https://a.com/1 *home"), tg.client, ORIGIN, NOW);
    await handleUpdate(env, msg("https://a.com/1"), tg.client, ORIGIN, NOW);
    expect(tg.sent()).toEqual(["✓ stashed for *brand · 1 waiting", "Already in your stash.", "Moved to *home", "Already in your stash."]);
    const items = await db.listItems(env.DB, "waiting", 10, false);
    expect(items.map((i) => [i.url, i.tag])).toEqual([["https://a.com/1", "home"]]);
  });

  it("reports moved and new links in one message", async () => {
    const tg = fakeTg();
    await handleUpdate(env, msg("https://a.com/1"), tg.client, ORIGIN, NOW);
    await handleUpdate(env, msg("https://a.com/2 *home"), tg.client, ORIGIN, NOW);
    await handleUpdate(env, msg("*brand https://a.com/1 https://a.com/2 https://a.com/3"), tg.client, ORIGIN, NOW);
    expect(tg.sent()[2]).toBe("✓ stashed for *brand · 3 waiting (2 moved to *brand)");
  });

  it("says when there is no link", async () => {
    const tg = fakeTg();
    await handleUpdate(env, msg("hello"), tg.client, ORIGIN, NOW);
    expect(tg.sent()).toEqual(["No link found. Forward or paste a link."]);
  });

  it("enforces the daily cap", async () => {
    for (let i = 0; i < DAILY_CAP; i++) await db.addItem(env.DB, { url: `https://a.com/${i}`, note: null, source: "other" }, NOW);
    const tg = fakeTg();
    await handleUpdate(env, msg("https://b.com/1"), tg.client, ORIGIN, NOW);
    expect(tg.sent()).toEqual([`Daily limit of ${DAILY_CAP} links reached. Try again tomorrow.`]);
  });
});

describe("ignored updates", () => {
  beforeEach(() => seedOwner(env.DB));

  it.each([
    ["a stranger", msg("https://a.com/1", { from: 7 })],
    ["a group chat", msg("https://a.com/1", { chatType: "group" })],
    ["an edited message", { update_id: 900, edited_message: msg("https://a.com/1").message }],
    ["a channel post", { update_id: 901, channel_post: { message_id: 1, chat: { id: -1, type: "channel" }, text: "https://a.com/1" } }],
    ["a sticker without text", { update_id: 902, message: { message_id: 1, from: { id: OWNER }, chat: { id: OWNER, type: "private" } } }],
  ])("ignores %s silently", async (_name, update) => {
    const tg = fakeTg();
    await handleUpdate(env, update as any, tg.client, ORIGIN, NOW);
    expect(tg.calls).toEqual([]);
    expect(await db.countByStatus(env.DB, "waiting")).toBe(0);
  });

  it("says nothing to anyone before the bot is claimed", async () => {
    await db.deleteSettings(env.DB, "owner_id");
    const tg = fakeTg();
    await handleUpdate(env, msg("https://a.com/1"), tg.client, ORIGIN, NOW);
    expect(tg.calls).toEqual([]);
  });
});

describe("commands", () => {
  beforeEach(() => seedOwner(env.DB));

  it("/start shows welcome and /help shows help text", async () => {
    const tg = fakeTg();
    await handleUpdate(env, msg("/start"), tg.client, ORIGIN, NOW);
    await handleUpdate(env, msg("/help@my_petty_thief_bot"), tg.client, ORIGIN, NOW);
    expect(tg.sent()).toEqual([WELCOME, HELP]);
  });

  it("/list shows waiting links newest first", async () => {
    await db.addItem(env.DB, { url: "https://a.com/1", note: "hook", source: "other" }, 1);
    await db.addItem(env.DB, { url: "https://a.com/2", note: null, source: "other" }, 2);
    const tg = fakeTg();
    await handleUpdate(env, msg("/list"), tg.client, ORIGIN, NOW);
    expect(tg.sent()).toEqual(["2 waiting\n\nno project · 2\n• https://a.com/2\n• https://a.com/1 — hook"]);
  });

  it("/list groups waiting links by project, biggest first, 5 per project", async () => {
    for (let i = 1; i <= 7; i++) await db.addItem(env.DB, { url: `https://b.com/${i}`, note: null, tag: "brand", source: "other" }, i);
    await db.addItem(env.DB, { url: "https://a.com/2", note: null, tag: "home", source: "other" }, 20);
    await db.addItem(env.DB, { url: "https://a.com/3", note: "why", source: "other" }, 30);
    const tg = fakeTg();
    await handleUpdate(env, msg("/list"), tg.client, ORIGIN, NOW);
    expect(tg.sent()[0]).toBe(
      "9 waiting\n\n*brand · 7\n• https://b.com/7\n• https://b.com/6\n• https://b.com/5\n• https://b.com/4\n• https://b.com/3\n  …and 2 more: /list brand" +
        "\n\n*home · 1\n• https://a.com/2\n\nno project · 1\n• https://a.com/3 — why",
    );
    await handleUpdate(env, msg("/list *Brand"), tg.client, ORIGIN, NOW);
    expect(tg.sent()[1].split("\n")[0]).toBe("*brand · 7 waiting:");
    await handleUpdate(env, msg("/list nowhere"), tg.client, ORIGIN, NOW);
    await handleUpdate(env, msg("/list bad name!"), tg.client, ORIGIN, NOW);
    expect(tg.sent().slice(2)).toEqual(["Nothing waiting for *nowhere.", "Send /list or /list <project>, for example /list brand."]);
  });

  it("/help explains project tags", async () => {
    expect(HELP).toContain("Add *project to send a link to one project, e.g. *brand");
  });

  it("/list and /done on an empty stash", async () => {
    const tg = fakeTg();
    await handleUpdate(env, msg("/list"), tg.client, ORIGIN, NOW);
    await handleUpdate(env, msg("/done"), tg.client, ORIGIN, NOW);
    expect(tg.sent()).toEqual(["Your stash is empty.", "Nothing analyzed yet."]);
  });

  it("/done shows recently analyzed links", async () => {
    const r = await db.addItem(env.DB, { url: "https://a.com/1", note: null, source: "other" }, 1);
    if (!r.added) throw new Error("expected added");
    await db.markDone(env.DB, r.item.id, { lens: "creator", summary: "Hook lands in 0.5 s", file: "a.md" }, 5);
    const tg = fakeTg();
    await handleUpdate(env, msg("/done"), tg.client, ORIGIN, NOW);
    expect(tg.sent()).toEqual(["Recently analyzed:\n\nno project\n• Hook lands in 0.5 s\n  https://a.com/1"]);
  });

  it("/undo removes the newest waiting link", async () => {
    await db.addItem(env.DB, { url: "https://a.com/1", note: null, source: "other" }, 1);
    const tg = fakeTg();
    await handleUpdate(env, msg("/undo"), tg.client, ORIGIN, NOW);
    await handleUpdate(env, msg("/undo"), tg.client, ORIGIN, NOW);
    expect(tg.sent()).toEqual(["Removed: https://a.com/1", "Nothing to undo."]);
  });

  it("/forget asks first and deletes on /forget yes", async () => {
    await db.addItem(env.DB, { url: "https://a.com/1", note: null, source: "other" }, 1);
    const tg = fakeTg();
    await handleUpdate(env, msg("/forget"), tg.client, ORIGIN, NOW);
    expect(await db.countByStatus(env.DB, "waiting")).toBe(1);
    await handleUpdate(env, msg("/forget yes"), tg.client, ORIGIN, NOW);
    expect(tg.sent()).toEqual([
      "This deletes all 1 links, including the analyzed list. Send /forget yes to confirm.",
      "Deleted 1 links.",
    ]);
    expect(await db.countByStatus(env.DB, "waiting")).toBe(0);
  });

  it("/connect and /rotate issue a new token and invalidate the old one", async () => {
    const tg = fakeTg();
    await handleUpdate(env, msg("/connect"), tg.client, ORIGIN, NOW);
    const first = await db.getSetting(env.DB, "api_token_hash");
    await handleUpdate(env, msg("/rotate"), tg.client, ORIGIN, NOW);
    const second = await db.getSetting(env.DB, "api_token_hash");
    expect(tg.calls.filter((c) => c.method === "setMyCommands")).toHaveLength(2);
    expect(first).toMatch(/^[0-9a-f]{64}$/);
    expect(second).not.toBe(first);
    expect(tg.sent()[1]).toMatch(new RegExp(`^Paste this into Claude Code:\\n\\nConnect Petty Thief: ${ORIGIN} pt_[A-Za-z0-9]{32}\\n`));
  });

  it("answers unknown commands and a second /claim", async () => {
    const tg = fakeTg();
    await handleUpdate(env, msg("/dance"), tg.client, ORIGIN, NOW);
    await handleUpdate(env, msg("/claim ABC123"), tg.client, ORIGIN, NOW);
    expect(tg.sent()).toEqual(["Unknown command. Send /help to see what I can do.", "This bot already has an owner."]);
  });
});

describe("/done by project and /clear", () => {
  beforeEach(() => seedOwner(env.DB));

  it("/done groups analyzed links by project", async () => {
    for (const [url, tag, s] of [["https://a.com/1", "brand", "One"], ["https://a.com/2", null, "Two"], ["https://a.com/3", "brand", "Three"]] as const) {
      const r = await db.addItem(env.DB, { url, note: null, tag, source: "other" }, 1);
      if (r.added) await db.markDone(env.DB, r.item.id, { lens: "creator", summary: s, file: null }, url.endsWith("1") ? 5 : url.endsWith("2") ? 6 : 7);
    }
    const tg = fakeTg();
    await handleUpdate(env, msg("/done"), tg.client, ORIGIN, NOW);
    expect(tg.sent()[0]).toBe("Recently analyzed:\n\n*brand\n• Three\n  https://a.com/3\n• One\n  https://a.com/1\n\nno project\n• Two\n  https://a.com/2");
  });

  it("/clear asks first, then deletes the last 48 hours of chat and keeps the stash", async () => {
    let nextBotMsg = 5000;
    const tg = fakeTg();
    const client = { async call(method: string, body: Record<string, any>) {
      const r = await tg.client.call(method, body);
      return method === "sendMessage" ? { ok: true, result: { message_id: nextBotMsg++ } } : r;
    } };
    const old = msg("https://a.com/old");
    await handleUpdate(env, old, client, ORIGIN, NOW - 49 * 3600_000);
    const link = msg("https://a.com/1");
    await handleUpdate(env, link, client, ORIGIN, NOW);
    await handleUpdate(env, msg("/clear"), client, ORIGIN, NOW);
    expect(tg.sent().at(-1)).toContain("Your stash stays");
    const cq = (data: string) => ({ update_id: 1, callback_query: { id: "c1", from: { id: OWNER }, data, message: { message_id: 5002, chat: { id: OWNER } } } });
    await handleUpdate(env, cq("c:yes"), client, ORIGIN, NOW + 1000);
    const del = tg.calls.find((c) => c.method === "deleteMessages")!;
    expect(del.body.chat_id).toBe(OWNER);
    expect(del.body.message_ids).not.toContain(old.message!.message_id);
    expect(del.body.message_ids).toEqual(expect.arrayContaining([link.message!.message_id, 5001, 5002]));
    expect(tg.calls.filter((c) => c.method === "answerCallbackQuery").at(-1)!.body.text).toMatch(/^Cleared \d+ messages/);
    expect(await db.countByStatus(env.DB, "waiting")).toBe(2);
  });

  it("ignores /clear taps from strangers; Cancel deletes only the prompt", async () => {
    const tg = fakeTg();
    const cq = (data: string, from: number) => ({ update_id: 1, callback_query: { id: "c", from: { id: from }, data, message: { message_id: 77, chat: { id: from } } } });
    await handleUpdate(env, cq("c:yes", 7), tg.client, ORIGIN, NOW);
    await handleUpdate(env, cq("c:no", OWNER), tg.client, ORIGIN, NOW);
    expect(tg.calls.map((c) => c.method)).toEqual(["answerCallbackQuery", "deleteMessage", "answerCallbackQuery"]);
  });
});
