import type { TgClient } from "./telegram";

export function telegramClient(rawToken: string): TgClient {
  // Trimmed: a trailing space or newline from the Cloudflare UI would break the API URL.
  const token = (rawToken ?? "").trim();
  return {
    async call(method, body) {
      let res: Response;
      try {
        res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        });
      } catch {
        // Network error or DNS failure: report it like a Telegram error instead of throwing.
        return { ok: false, description: "couldn't reach Telegram" };
      }
      try {
        return await res.json();
      } catch {
        // An HTML error page from a proxy, or an empty body: report it like a Telegram error.
        return { ok: false, description: `HTTP ${res.status}` };
      }
    },
  };
}
