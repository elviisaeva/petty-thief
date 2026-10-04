import { MAX_BODY, type Env } from "./env";
import { safeEqual, sha256Hex } from "./auth";
import { getSetting } from "./db";
import { ensureSchema } from "./schema";
import { handleUpdate, type TgClient, type TgUpdate } from "./telegram";

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
  return new Response("ok");
}
