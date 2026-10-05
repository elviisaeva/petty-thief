import { MAX_BODY, type Env } from "./env";
import { safeEqual, sha256Hex } from "./auth";
import { countByStatus, countWaitingByTag, getSetting, hitRateLimit, listItems, markDone, markSkipped, setProject, type Status, type TagFilter } from "./db";
import { TAG_NAME_RE } from "./urls";
import { ensureSchema } from "./schema";
import { registerWebhook } from "./setup";
import type { TgClient } from "./telegram";

export const API_PER_MINUTE = 60;
export const API_UNAUTH_PER_MINUTE = 120;
const FIELD_MAX = 500;
const MAX_PROJECT_LENSES = 24;
const STATUSES: Status[] = ["waiting", "done", "skipped"];

const json = (status: number, data: unknown) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });

const clip = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim().slice(0, FIELD_MAX) : null);

/**
 * `tag=<name>` and `untagged=0|1` (default 1): that tag's links, plus untagged ones with 1.
 * `untagged=only` without a tag: only untagged links. No tag otherwise: every link, as before tags existed.
 */
function tagFilter(params: URLSearchParams): TagFilter | undefined | "bad" {
  const tag = params.get("tag");
  const untagged = params.get("untagged") ?? "1";
  if (untagged !== "0" && untagged !== "1" && untagged !== "only") return "bad";
  if (tag === null) return untagged === "only" ? { untaggedOnly: true } : undefined;
  if (untagged === "only") return "bad";
  const name = tag.toLowerCase();
  if (!TAG_NAME_RE.test(name)) return "bad";
  return { tag: name, untagged: untagged === "1" };
}

const BAD_TAG = { error: "tag must be 1-32 letters, digits or hyphens; untagged must be 0, 1, or only (without tag); by_tag must be 0 or 1" };

export async function handleApi(req: Request, env: Env, now = Date.now(), tg?: TgClient): Promise<Response> {
  await ensureSchema(env.DB);
  const minute = Math.floor(now / 60_000);

  // Authenticate first. Strangers are counted in their own bucket, so they can never use up the owner's.
  const m = (req.headers.get("Authorization") ?? "").match(/^Bearer\s+(\S+)$/);
  const stored = await getSetting(env.DB, "api_token_hash");
  if (!m || !stored || !safeEqual(await sha256Hex(m[1]), stored)) {
    if (!(await hitRateLimit(env.DB, "api_unauth", minute, API_UNAUTH_PER_MINUTE))) return json(429, { error: "rate limited" });
    return json(401, { error: "unauthorized" });
  }
  if (!(await hitRateLimit(env.DB, "api", minute, API_PER_MINUTE))) return json(429, { error: "rate limited" });

  const url = new URL(req.url);
  const path = url.pathname;

  if (req.method === "GET" && path === "/api/count") {
    const filter = tagFilter(url.searchParams);
    const byTag = url.searchParams.get("by_tag") ?? "0";
    if (filter === "bad" || (byTag !== "0" && byTag !== "1")) return json(400, BAD_TAG);
    // `waiting` is what the filter selects; `tagged` (by_tag=1) counts every waiting tagged link per tag.
    const waiting = await countByStatus(env.DB, "waiting", filter);
    return json(200, byTag === "1" ? { waiting, tagged: await countWaitingByTag(env.DB) } : { waiting });
  }

  if (req.method === "GET" && path === "/api/items") {
    const status = (url.searchParams.get("status") ?? "waiting") as Status;
    if (!STATUSES.includes(status)) return json(400, { error: "status must be waiting, done or skipped" });
    const filter = tagFilter(url.searchParams);
    if (filter === "bad") return json(400, BAD_TAG);
    const limit = Math.min(Math.max(Number(url.searchParams.get("limit")) || 50, 1), 200);
    return json(200, { items: await listItems(env.DB, status, limit, status !== "waiting", filter) });
  }

  // Re-registers the Telegram webhook with a fresh secret: the fix when the bot stops answering
  // or its buttons don't react. The owner's API key proves who asks; Telegram's answer is returned.
  if (req.method === "POST" && path === "/api/webhook" && tg) {
    if (!(await getSetting(env.DB, "owner_id"))) return json(409, { error: "finish /setup first" });
    const hook = await registerWebhook(env, tg, url.origin, false);
    return json(hook?.ok ? 200 : 502, { ok: Boolean(hook?.ok), telegram: String(hook?.description ?? "no answer").slice(0, 200) });
  }

  // The skill sends a project's lens and collection names, for the bot's lens buttons.
  // `-` is the project without a tag. Names only: nothing else about the project leaves the computer.
  const project = path.match(/^\/api\/projects\/([a-z0-9-]{1,32})$/);
  if (req.method === "PUT" && project) {
    const key = project[1] === "-" ? "" : project[1];
    if (key && !TAG_NAME_RE.test(key)) return json(400, { error: "project must be - or 1-32 letters, digits or hyphens" });
    const raw = await req.text();
    if (new TextEncoder().encode(raw).length > MAX_BODY) return json(413, { error: "body too large" });
    let lenses: unknown;
    try {
      lenses = JSON.parse(raw)?.lenses;
    } catch {
      return json(400, { error: "body must be JSON" });
    }
    if (!Array.isArray(lenses) || lenses.length > MAX_PROJECT_LENSES || !lenses.every((l) => typeof l === "string" && TAG_NAME_RE.test(l))) {
      return json(400, { error: `lenses must be up to ${MAX_PROJECT_LENSES} names of 1-32 lowercase letters, digits or hyphens` });
    }
    await setProject(env.DB, key, [...new Set(lenses as string[])], now);
    return json(200, { ok: true });
  }

  const action = path.match(/^\/api\/items\/([a-z0-9]{1,40})\/(done|skip)$/);
  if (req.method === "POST" && action) {
    const raw = await req.text();
    if (new TextEncoder().encode(raw).length > MAX_BODY) return json(413, { error: "body too large" });
    let body: Record<string, unknown> = {};
    if (raw.trim()) {
      try {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === "object") body = parsed;
      } catch {
        return json(400, { error: "body must be JSON" });
      }
    }
    const ok =
      action[2] === "done"
        ? await markDone(env.DB, action[1], { lens: clip(body.lens), summary: clip(body.summary), file: clip(body.file) }, now)
        : await markSkipped(env.DB, action[1], clip(body.reason), now);
    return ok ? json(200, { ok: true }) : json(404, { error: "no waiting item with this id" });
  }

  return json(404, { error: "not found" });
}
