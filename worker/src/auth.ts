const ALNUM = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
const CODE = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const WEBHOOK = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-";
const ID = "0123456789abcdefghijklmnopqrstuvwxyz";

export async function sha256Hex(s: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function safeEqual(a: string, b: string): boolean {
  const ea = new TextEncoder().encode(a);
  const eb = new TextEncoder().encode(b);
  if (ea.length !== eb.length) return false;
  return crypto.subtle.timingSafeEqual(ea, eb);
}

/** Uniform random string. Rejection sampling avoids modulo bias. */
export function randomString(len: number, alphabet = ALNUM): string {
  const limit = 256 - (256 % alphabet.length);
  let out = "";
  while (out.length < len) {
    for (const b of crypto.getRandomValues(new Uint8Array(len * 2))) {
      if (b >= limit) continue;
      out += alphabet[b % alphabet.length];
      if (out.length === len) break;
    }
  }
  return out;
}

export const newApiToken = (): string => `pt_${randomString(32)}`;
export const newClaimCode = (): string => randomString(6, CODE);
export const newWebhookSecret = (): string => randomString(48, WEBHOOK);

/** 9 base-36 chars of time + 8 random chars, so ids sort by creation time. */
export function newId(now = Date.now()): string {
  return now.toString(36).padStart(9, "0") + randomString(8, ID);
}
