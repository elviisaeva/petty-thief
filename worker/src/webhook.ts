import { MAX_BODY, type Env } from "./env";
import { safeEqual, sha256Hex } from "./auth";
import { getSetting } from "./db";
import { ensureSchema } from "./schema";
import { handleUpdate, type TgClient, type TgUpdate } from "./telegram";
import { upgradeWebhook } from "./setup";
import { BRANDING_VERSION, applyBranding } from "./branding";
import { claimOnce, setSetting } from "./db";

export async function handleWebhook(req: Request, env: Env, tg: TgClient, now = Date.now()): Promise<Response> {
  await ensureSchema(env.DB);
  const secret = req.headers.get("X-Telegram-Bot-Api-Secret-Token") ?? "";
  const stored = await getSetting(env.DB, "webhook_secret_hash");
  if (!stored || !secret || !safeEqual(await sha256Hex(secret), stored)) {
    return new Response("unauthorized", { status: 401 });
  }
  const body = await req.text();
  // Always 200 from here on: any other status makes Telegram retry the same update.
  if (new TextEncoder().encode(body).length > MAX_BODY) return new Response("ignored");
  let update: TgUpdate;
  try {
    update = JSON.parse(body);
  } catch {
    return new Response("ignored");
  }
  try {
    await handleUpdate(env, update, tg, new URL(req.url).origin, now);
  } catch (e) {
    console.error("update failed:", e instanceof Error ? e.message : "unknown error");
  }
  // After the update, so it is handled with the secret it arrived with.
  try {
    await upgradeWebhook(env, tg, new URL(req.url).origin, now);
  } catch (e) {
    console.error("webhook upgrade failed:", e instanceof Error ? e.message : "unknown error");
  }
  // New commands reach the bot's menu without a /connect: once per branding version.
  try {
    if ((await getSetting(env.DB, "branding_version")) !== BRANDING_VERSION && (await claimOnce(env.DB, "branding_at", now, 10 * 60 * 1000))) {
      await applyBranding(tg);
      await setSetting(env.DB, "branding_version", BRANDING_VERSION);
    }
  } catch (e) {
    console.error("branding failed:", e instanceof Error ? e.message : "unknown error");
  }
  return new Response("ok");
}
