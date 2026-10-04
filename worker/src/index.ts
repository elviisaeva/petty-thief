import type { Env } from "./env";
import { handleApi } from "./api";
import { handleSetup } from "./setup";
import { telegramClient } from "./telegram-client";
import { handleWebhook } from "./webhook";

export default {
  async fetch(req, env): Promise<Response> {
    const { pathname } = new URL(req.url);
    if (pathname === "/telegram" && req.method === "POST") return handleWebhook(req, env, telegramClient(env.BOT_TOKEN));
    if (pathname === "/setup") return handleSetup(req, env, telegramClient(env.BOT_TOKEN));
    if (pathname.startsWith("/api/")) return handleApi(req, env);
    if (pathname === "/") {
      return new Response("Petty Thief is running. Open /setup to finish setting it up.", { headers: { "content-type": "text/plain; charset=utf-8" } });
    }
    return new Response("Not found", { status: 404 });
  },
} satisfies ExportedHandler<Env>;
