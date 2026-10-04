import { describe, expect, it } from "vitest";
import { newApiToken, newClaimCode, newId, newWebhookSecret, randomString, safeEqual, sha256Hex } from "../src/auth";

describe("auth helpers", () => {
  it("hashes with SHA-256 hex", async () => {
    expect(await sha256Hex("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });

  it("compares in constant time and handles different lengths", () => {
    expect(safeEqual("secret", "secret")).toBe(true);
    expect(safeEqual("secret", "secreT")).toBe(false);
    expect(safeEqual("secret", "secret!")).toBe(false);
    expect(safeEqual("", "")).toBe(true);
  });

  it("makes random strings from the given alphabet", () => {
    const s = randomString(200, "ab");
    expect(s).toHaveLength(200);
    expect(s).toMatch(/^[ab]+$/);
    expect(s).toMatch(/a/);
    expect(s).toMatch(/b/);
  });

  it("makes tokens, codes and secrets in the right shapes", () => {
    expect(newApiToken()).toMatch(/^pt_[A-Za-z0-9]{32}$/);
    expect(newClaimCode()).toMatch(/^[A-HJ-NP-Z2-9]{6}$/);
    expect(newWebhookSecret()).toMatch(/^[A-Za-z0-9_-]{48}$/);
    expect(newApiToken()).not.toBe(newApiToken());
  });

  it("makes time-sortable ids", () => {
    const a = newId(1_000);
    const b = newId(2_000_000_000_000);
    expect(a).toHaveLength(17);
    expect(a.startsWith((1_000).toString(36).padStart(9, "0"))).toBe(true);
    expect(a < b).toBe(true);
  });
});
