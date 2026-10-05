import type { Env } from "./env";
import { newClaimCode, newWebhookSecret, safeEqual, sha256Hex } from "./auth";
import { claimOnce, getSetting, hitRateLimit, setSetting } from "./db";
import { ensureSchema } from "./schema";
import type { TgClient } from "./telegram";
import { applyBranding } from "./branding";

export const CLAIM_TTL_MS = 60 * 60 * 1000;
/** Button taps arrive as callback_query updates; Telegram sends only the kinds listed here. */
export const WEBHOOK_UPDATES = ["message", "callback_query"];

/**
 * Points Telegram at this worker with a fresh secret. The secret's hash is stored only after
 * Telegram accepted it, so a failed attempt never breaks a working webhook.
 */
export async function registerWebhook(env: Env, tg: TgClient, origin: string, dropPending: boolean): Promise<any> {
  const secret = newWebhookSecret();
  const hook = await tg.call("setWebhook", {
    url: `${origin}/telegram`,
    secret_token: secret,
    allowed_updates: WEBHOOK_UPDATES,
    drop_pending_updates: dropPending,
  });
  if (hook?.ok) {
    await setSetting(env.DB, "webhook_secret_hash", await sha256Hex(secret));
    await setSetting(env.DB, "webhook_updates", WEBHOOK_UPDATES.join(","));
  }
  return hook;
}

/**
 * Bots set up before the lens buttons registered for messages only. On the owner's next update,
 * register again with button taps included. At most one try an hour if Telegram says no.
 */
export async function upgradeWebhook(env: Env, tg: TgClient, origin: string, now: number): Promise<void> {
  if ((await getSetting(env.DB, "webhook_updates")) === WEBHOOK_UPDATES.join(",")) return;
  if (!(await getSetting(env.DB, "owner_id"))) return;
  // Button taps and a message often arrive together: only one isolate may re-register, or two
  // fresh secrets race and Telegram keeps one the database doesn't have.
  if (!(await claimOnce(env.DB, "webhook_upgrade_at", now, 60 * 60 * 1000))) return;
  const hook = await registerWebhook(env, tg, origin, false);
  if (!hook?.ok) console.error("webhook upgrade refused:", String(hook?.description ?? "no answer").slice(0, 200));
}

const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

function page(status: number, title: string, body: string): Response {
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title><style>
body{font:16px/1.55 system-ui,sans-serif;max-width:34rem;margin:3rem auto;padding:0 1rem;color:#16181f;background:#f2f3f6}
h1{font-size:1.5rem}input{width:100%;font:inherit;padding:.6rem;border:1px solid #bbb;border-radius:6px;box-sizing:border-box}
button{margin-top:.8rem;font:inherit;padding:.6rem 1.2rem;border:0;border-radius:6px;background:#2f47c9;color:#fff;cursor:pointer}
.err{color:#a3001b}.code{font:600 1.4rem ui-monospace,monospace;background:#fff;padding:.6rem 1rem;border-radius:6px;display:inline-block}
@media (prefers-color-scheme:dark){body{background:#12141a;color:#e8eaf0}.code{background:#1b1e26}input{background:#1b1e26;color:#e8eaf0}}
</style></head><body><h1>${esc(title)}</h1>${body}</body></html>`;
  return new Response(html, {
    status,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      "x-frame-options": "DENY",
      "referrer-policy": "no-referrer",
      "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'",
    },
  });
}

function form(error?: string): string {
  return `<p>Paste your bot token from @BotFather. This proves the bot is yours. It is checked against the token you saved in Cloudflare and is not stored again.</p>
${error ? `<p class="err">${esc(error)}</p>` : ""}
<form method="post"><label for="token">Bot token</label>
<input id="token" name="token" type="password" autocomplete="off" required>
<button type="submit">Connect Telegram</button></form>`;
}

export async function handleSetup(req: Request, env: Env, tg: TgClient, now = Date.now()): Promise<Response> {
  await ensureSchema(env.DB);
  // The lock: setup is finished exactly when an owner exists. There is no separate flag.
  if (await getSetting(env.DB, "owner_id")) {
    return page(410, "Setup is finished", "<p>This bot already has an owner, so this page is locked.</p><p>Need to reconnect Claude Code? Send <code>/connect</code> to your bot.</p>");
  }
  // Trimmed: a secret pasted into the Cloudflare UI often carries a trailing space or newline.
  const botToken = (env.BOT_TOKEN ?? "").trim();
  if (!botToken) {
    return page(500, "One step is missing", "<p>Cloudflare has no BOT_TOKEN secret yet. Open your worker → Settings → Variables and Secrets, add BOT_TOKEN, then reload this page.</p>");
  }
  if (req.method === "GET") return page(200, "Finish setting up Petty Thief", form());
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });
  // One global bucket: a stranger could use up the 10 attempts and delay setup by a minute.
  // Acceptable, because setup is a one-time step and the claim code is valid for an hour.
  if (!(await hitRateLimit(env.DB, "setup", Math.floor(now / 60_000), 10))) {
    return page(429, "Slow down", "<p>Too many attempts. Wait a minute and try again.</p>");
  }

  let token: string;
  try {
    token = String((await req.formData()).get("token") ?? "").trim();
  } catch {
    return page(400, "Finish setting up Petty Thief", form("That form didn't come through. Paste the token and try again."));
  }
  if (!token || !safeEqual(token, botToken)) {
    return page(403, "Finish setting up Petty Thief", form("That token doesn't match the one saved in Cloudflare. Copy it again from @BotFather."));
  }

  const origin = new URL(req.url).origin;
  let hook: any;
  try {
    hook = await registerWebhook(env, tg, origin, true);
  } catch {
    return page(502, "Telegram said no", "<p>Couldn't reach Telegram. Wait a moment and try again.</p>");
  }
  if (!hook?.ok) {
    return page(502, "Telegram said no", `<p>Telegram didn't accept the connection: ${esc(String(hook?.description ?? "no answer"))}</p><p>Check the bot token and try again.</p>`);
  }
  // An update that arrives in the few milliseconds before the secret is stored gets a 401 and is retried by Telegram.
  await applyBranding(tg);

  // The webhook is already registered, so a failed getMe only costs us the bot's name.
  let me: any = null;
  try {
    me = await tg.call("getMe", {});
  } catch {
    me = null;
  }
  const bot = me?.result?.username ? `@${me.result.username}` : "your bot";
  const code = newClaimCode();
  await setSetting(env.DB, "claim_code_hash", await sha256Hex(code));
  await setSetting(env.DB, "claim_expires", String(now + CLAIM_TTL_MS));
  await setSetting(env.DB, "claim_attempts", "0");
  return page(200, "Almost done", `<p>Open ${esc(bot)} in Telegram and send:</p><p class="code">/claim ${code}</p><p>The code works for one hour. After that the bot answers only you, and this page locks.</p>`);
}
