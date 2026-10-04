export interface Env {
  DB: D1Database;
  BOT_TOKEN: string;
}

/** Requests with a larger body are ignored (webhook) or rejected (API). */
export const MAX_BODY = 16 * 1024;
