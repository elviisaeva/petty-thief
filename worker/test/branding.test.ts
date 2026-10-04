import { describe, expect, it } from "vitest";
import { applyBranding, BOT_COMMANDS, BOT_DESCRIPTION, BOT_SHORT_DESCRIPTION } from "../src/branding";
import type { TgClient } from "../src/telegram";
import { fakeTg } from "./helpers";

describe("branding", () => {
  it("respects Telegram limits", () => {
    expect(BOT_DESCRIPTION.length).toBeLessThanOrEqual(512);
    expect(BOT_SHORT_DESCRIPTION.length).toBeLessThanOrEqual(120);
    for (const c of BOT_COMMANDS) {
      expect(c.command).toMatch(/^[a-z0-9_]{1,32}$/);
      expect(c.description.length).toBeGreaterThanOrEqual(1);
      expect(c.description.length).toBeLessThanOrEqual(256);
    }
  });

  it("calls the three Telegram methods", async () => {
    const tg = fakeTg();
    await applyBranding(tg.client);
    expect(tg.calls).toEqual([
      { method: "setMyCommands", body: { commands: BOT_COMMANDS } },
      { method: "setMyDescription", body: { description: BOT_DESCRIPTION } },
      { method: "setMyShortDescription", body: { short_description: BOT_SHORT_DESCRIPTION } },
    ]);
  });

  it("never throws", async () => {
    const bad: TgClient = { async call() { throw new Error("boom"); } };
    await expect(applyBranding(bad)).resolves.toBeUndefined();
  });
});
