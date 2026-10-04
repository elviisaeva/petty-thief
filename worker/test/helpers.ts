import type { Entity } from "../src/urls";
import type { TgClient, TgUpdate } from "../src/telegram";
import { setSetting } from "../src/db";

export const OWNER = 42;
export const ORIGIN = "https://pt.example.workers.dev";

export function fakeTg(responses: Record<string, unknown> = {}) {
  const calls: { method: string; body: Record<string, any> }[] = [];
  const client: TgClient = {
    async call(method, body) {
      calls.push({ method, body });
      return responses[method] ?? { ok: true, result: {} };
    },
  };
  return { client, calls, sent: () => calls.filter((c) => c.method === "sendMessage").map((c) => c.body.text as string) };
}

let nextUpdate = 1;
export function msg(text: string, opts: { from?: number; chatType?: string; entities?: Entity[]; caption?: boolean } = {}): TgUpdate {
  const from = opts.from ?? OWNER;
  return {
    update_id: nextUpdate++,
    message: {
      message_id: nextUpdate,
      from: { id: from },
      chat: { id: from, type: opts.chatType ?? "private" },
      ...(opts.caption ? { caption: text, caption_entities: opts.entities } : { text, entities: opts.entities }),
    },
  };
}

export async function seedOwner(db: D1Database, id = OWNER): Promise<void> {
  await setSetting(db, "owner_id", String(id));
}
