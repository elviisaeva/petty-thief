// worker/test/picker.test.ts
import { SELF, env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { sha256Hex } from "../src/auth";
import * as db from "../src/db";
import { DEFAULT_LENSES, MAX_PICKS, PROJECT_TTL_MS } from "../src/picker";
import { handleUpdate, type TgUpdate } from "../src/telegram";
import { handleWebhook } from "../src/webhook";
import { ORIGIN, OWNER, fakeTg, msg, seedOwner } from "./helpers";

const NOW = Date.UTC(2026, 9, 5, 12);
const BOT_MSG = 900;

type Kb = { inline_keyboard: { text: string; callback_data: string }[][] };
const labels = (kb: Kb) => kb.inline_keyboard.flat().map((b) => b.text);

let nextCq = 1;
function tap(data: string, from = OWNER): TgUpdate {
  return { update_id: 10_000 + nextCq, callback_query: { id: `cq${nextCq++}`, from: { id: from }, data, message: { message_id: BOT_MSG, chat: { id: from } } } };
}

/** Stashes one link and returns the Telegram message id its buttons act on. */
async function stashOne(text: string, tg = fakeTg()): Promise<{ id: number; kb: Kb }> {
  const update = msg(text);
  await handleUpdate(env, update, tg.client, ORIGIN, NOW);
  const sent = tg.calls.find((c) => c.method === "sendMessage")!;
  return { id: update.message!.message_id, kb: sent.body.reply_markup as Kb };
}

/** The keyboard of the last edit, from editMessageReplyMarkup or editMessageText. */
const lastKb = (tg: ReturnType<typeof fakeTg>) =>
  [...tg.calls].reverse().find((c) => c.method === "editMessageReplyMarkup" || c.method === "editMessageText")!.body.reply_markup as Kb;
const answers = (tg: ReturnType<typeof fakeTg>) => tg.calls.filter((c) => c.method === "answerCallbackQuery").map((c) => c.body.text ?? null);

describe("lens buttons", () => {
  beforeEach(() => seedOwner(env.DB));

  it("puts the built-in lenses, auto, frame by frame and the project under ✓ stashed", async () => {
    const { kb } = await stashOne("https://a.com/1");
    expect(labels(kb)).toEqual([...DEFAULT_LENSES, "✓ auto", "🎞 frame by frame", "📁 no project ▾"]);
  });

  it("shows the project's own lenses once Claude Code has sent them", async () => {
    await db.setProject(env.DB, "brand", ["creator", "design", "watchlist"], NOW);
    const { kb } = await stashOne("*brand https://a.com/1");
    expect(labels(kb)).toEqual(["creator", "design", "watchlist", "✓ auto", "🎞 frame by frame", "📁 *brand ▾"]);
  });

  it("toggles lenses into the note the skill reads, up to 3", async () => {
    const tg = fakeTg();
    const { id } = await stashOne("why saved https://a.com/1");
    for (const d of ["design", "creator", "dev", "ai"]) await handleUpdate(env, tap(`l:${id}:${d}`), tg.client, ORIGIN, NOW);
    expect(answers(tg)).toEqual([null, null, null, `Up to ${MAX_PICKS} lenses per link.`]);
    expect(labels(lastKb(tg)).slice(0, 5)).toEqual(["✓ creator", "✓ dev", "ai", "learn", "✓ design"]);
    await handleUpdate(env, tap(`l:${id}:dev`), tg.client, ORIGIN, NOW);
    await handleUpdate(env, tap(`d:${id}`), tg.client, ORIGIN, NOW);
    const [item] = await db.listItems(env.DB, "waiting", 10, false);
    expect(item.note).toBe("lens:design,creator deep why saved");
    expect(Object.keys(item)).not.toContain("pick_lenses");
  });

  it("auto clears the picks; frame by frame toggles", async () => {
    const tg = fakeTg();
    const { id } = await stashOne("https://a.com/1");
    await handleUpdate(env, tap(`l:${id}:dev`), tg.client, ORIGIN, NOW);
    await handleUpdate(env, tap(`d:${id}`), tg.client, ORIGIN, NOW);
    await handleUpdate(env, tap(`a:${id}`), tg.client, ORIGIN, NOW);
    expect(labels(lastKb(tg))).toContain("✓ auto");
    await handleUpdate(env, tap(`d:${id}`), tg.client, ORIGIN, NOW);
    const [item] = await db.listItems(env.DB, "waiting", 10, false);
    expect(item.note).toBeNull();
  });

  it("moves a link to another synced project and offers that project's lenses", async () => {
    await db.setProject(env.DB, "brand", ["creator", "design"], NOW);
    await db.setProject(env.DB, "home", ["recipes", "design"], NOW);
    await db.setProject(env.DB, "old", ["dev"], NOW - PROJECT_TTL_MS - 1);
    const tg = fakeTg();
    const { id } = await stashOne("*brand https://a.com/1");
    await handleUpdate(env, tap(`l:${id}:creator`), tg.client, ORIGIN, NOW);
    await handleUpdate(env, tap(`l:${id}:design`), tg.client, ORIGIN, NOW);
    await handleUpdate(env, tap(`p:${id}`), tg.client, ORIGIN, NOW);
    expect(labels(lastKb(tg)).sort()).toEqual(["*home", "« back", "no project", "✓ *brand"].sort());
    await handleUpdate(env, tap(`t:${id}:home`), tg.client, ORIGIN, NOW);
    const edit = tg.calls.find((c) => c.method === "editMessageText")!;
    expect(edit.body.text).toBe("✓ stashed for *home · 1 waiting");
    expect(labels(lastKb(tg)).slice(0, 2)).toEqual(["recipes", "✓ design"]);
    const [item] = await db.listItems(env.DB, "waiting", 10, false);
    expect([item.tag, item.note]).toEqual(["home", "lens:design"]);
    await handleUpdate(env, tap(`t:${id}:-`), tg.client, ORIGIN, NOW);
    expect((await db.listItems(env.DB, "waiting", 10, false))[0].tag).toBeNull();
  });

  it("refuses unknown projects and lenses that aren't offered", async () => {
    const tg = fakeTg();
    const { id } = await stashOne("https://a.com/1");
    await handleUpdate(env, tap(`t:${id}:nowhere`), tg.client, ORIGIN, NOW);
    await handleUpdate(env, tap(`l:${id}:secret-lens`), tg.client, ORIGIN, NOW);
    expect(answers(tg)).toEqual(["Unknown project.", "This lens isn't offered here."]);
    expect((await db.listItems(env.DB, "waiting", 10, false))[0]).toMatchObject({ tag: null, note: null });
  });

  it("ignores taps from strangers and malformed data, but always answers them", async () => {
    const tg = fakeTg();
    const { id } = await stashOne("https://a.com/1");
    await handleUpdate(env, tap(`l:${id}:dev`, 7), tg.client, ORIGIN, NOW);
    await handleUpdate(env, tap(`l:${id}:dev; rm -rf`), tg.client, ORIGIN, NOW);
    await handleUpdate(env, tap(`x:${id}`), tg.client, ORIGIN, NOW);
    expect(tg.calls.map((c) => c.method)).toEqual(["answerCallbackQuery", "answerCallbackQuery", "answerCallbackQuery"]);
    expect((await db.listItems(env.DB, "waiting", 10, false))[0].note).toBeNull();
  });

  it("removes the buttons once the link is analyzed", async () => {
    const tg = fakeTg();
    const { id } = await stashOne("https://a.com/1");
    const [item] = await db.listItems(env.DB, "waiting", 10, false);
    await db.markDone(env.DB, item.id, { lens: "dev", summary: null, file: null }, NOW);
    await handleUpdate(env, tap(`l:${id}:dev`), tg.client, ORIGIN, NOW);
    expect(lastKb(tg)).toEqual({ inline_keyboard: [] });
    expect(answers(tg)).toEqual(["Already analyzed or removed."]);
  });

  it("sends no buttons when nothing new was stashed", async () => {
    const tg = fakeTg();
    await handleUpdate(env, msg("https://a.com/1"), tg.client, ORIGIN, NOW);
    await handleUpdate(env, msg("https://a.com/1"), tg.client, ORIGIN, NOW);
    const sent = tg.calls.filter((c) => c.method === "sendMessage");
    expect(sent[1].body).not.toHaveProperty("reply_markup");
  });
});

describe("webhook upgrade for button taps", () => {
  const SECRET = "old_secret";
  const post = (body: unknown, secret: string) =>
    new Request(`${ORIGIN}/telegram`, { method: "POST", headers: { "X-Telegram-Bot-Api-Secret-Token": secret }, body: JSON.stringify(body) });

  beforeEach(async () => {
    await seedOwner(env.DB);
    await db.setSetting(env.DB, "webhook_secret_hash", await sha256Hex(SECRET));
  });

  it("re-registers an old messages-only webhook once, with a new secret", async () => {
    const tg = fakeTg();
    await handleWebhook(post(msg("https://a.com/1"), SECRET), env, tg.client, NOW);
    const hooks = tg.calls.filter((c) => c.method === "setWebhook");
    expect(hooks).toHaveLength(1);
    expect(hooks[0].body).toMatchObject({ url: `${ORIGIN}/telegram`, allowed_updates: ["message", "callback_query"], drop_pending_updates: false });
    expect(await db.getSetting(env.DB, "webhook_secret_hash")).toBe(await sha256Hex(hooks[0].body.secret_token));
    expect((await handleWebhook(post(msg("https://a.com/2"), SECRET), env, tg.client, NOW)).status).toBe(401);
    await handleWebhook(post(msg("https://a.com/3"), hooks[0].body.secret_token), env, tg.client, NOW);
    expect(tg.calls.filter((c) => c.method === "setWebhook")).toHaveLength(1);
  });

  it("keeps the old secret when Telegram refuses, and waits an hour before trying again", async () => {
    const tg = fakeTg({ setWebhook: { ok: false, description: "nope" } });
    await handleWebhook(post(msg("https://a.com/1"), SECRET), env, tg.client, NOW);
    await handleWebhook(post(msg("https://a.com/2"), SECRET), env, tg.client, NOW + 60_000);
    expect(tg.calls.filter((c) => c.method === "setWebhook")).toHaveLength(1);
    expect(await db.countByStatus(env.DB, "waiting")).toBe(2);
    await handleWebhook(post(msg("https://a.com/3"), SECRET), env, tg.client, NOW + 61 * 60_000);
    expect(tg.calls.filter((c) => c.method === "setWebhook")).toHaveLength(2);
  });
});

describe("api: projects", () => {
  const TOKEN = "pt_" + "proj".repeat(8);
  const put = (key: string, body: string) =>
    SELF.fetch(`https://pt.example.workers.dev/api/projects/${key}`, { method: "PUT", headers: { Authorization: `Bearer ${TOKEN}` }, body });

  beforeEach(async () => {
    await db.setSetting(env.DB, "api_token_hash", await sha256Hex(TOKEN));
  });

  it("stores a project's lens names, deduplicated; - is the project without a tag", async () => {
    expect((await put("brand", JSON.stringify({ lenses: ["creator", "design", "creator"] }))).status).toBe(200);
    expect((await put("-", JSON.stringify({ lenses: ["dev"] }))).status).toBe(200);
    const projects = await db.listProjects(env.DB, 0);
    expect(projects.map((p) => [p.tag, p.lenses]).sort()).toEqual([["", ["dev"]], ["brand", ["creator", "design"]]]);
  });

  it("rejects bad names, too many lenses and non-JSON", async () => {
    expect((await put("Brand!", "{}")).status).toBe(404);
    expect((await put("brand", JSON.stringify({ lenses: ["Bad Name"] }))).status).toBe(400);
    expect((await put("brand", JSON.stringify({ lenses: Array.from({ length: 25 }, (_, i) => `l${i}`) }))).status).toBe(400);
    expect((await put("brand", "not json")).status).toBe(400);
    expect((await put("-x", JSON.stringify({ lenses: [] }))).status).toBe(400);
    expect(await db.listProjects(env.DB, 0)).toEqual([]);
  });

  it("needs the token", async () => {
    const res = await SELF.fetch("https://pt.example.workers.dev/api/projects/brand", { method: "PUT", body: JSON.stringify({ lenses: [] }) });
    expect(res.status).toBe(401);
  });
});
