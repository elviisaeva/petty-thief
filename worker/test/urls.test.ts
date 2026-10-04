import { describe, expect, it } from "vitest";
import { detectSource, extractLinks, extractTag, normalizeUrl, type Entity } from "../src/urls";

/** Builds a Telegram `url` entity for `url` inside `text`, using JS (UTF-16) offsets like Telegram does. */
function ent(text: string, url: string): Entity {
  return { type: "url", offset: text.indexOf(url), length: url.length };
}

describe("extractLinks", () => {
  it("takes urls from url entities and keeps the rest as the note", () => {
    const t = "look https://vt.tiktok.com/ZS123/ nice hook";
    expect(extractLinks(t, [ent(t, "https://vt.tiktok.com/ZS123/")])).toEqual({
      urls: ["https://vt.tiktok.com/ZS123/"],
      note: "look nice hook",
    });
  });

  it("handles emoji and Cyrillic before the link (UTF-16 offsets)", () => {
    const t = "🔥🔥 смотри https://youtu.be/abc детально";
    expect(extractLinks(t, [ent(t, "https://youtu.be/abc")])).toEqual({
      urls: ["https://youtu.be/abc"],
      note: "🔥🔥 смотри детально",
    });
  });

  it("takes the target of text_link entities", () => {
    const t = "this video";
    const e: Entity[] = [{ type: "text_link", offset: 5, length: 5, url: "https://www.instagram.com/reel/XYZ/" }];
    expect(extractLinks(t, e)).toEqual({ urls: ["https://www.instagram.com/reel/XYZ/"], note: "this video" });
  });

  it("falls back to a regex when there are no link entities and strips trailing punctuation", () => {
    expect(extractLinks("see https://github.com/a/b.", undefined)).toEqual({
      urls: ["https://github.com/a/b"],
      note: "see .",
    });
  });

  it("keeps trailing parentheses in url entities exactly", () => {
    const t = "read https://en.wikipedia.org/wiki/Foo_(bar)";
    expect(extractLinks(t, [ent(t, "https://en.wikipedia.org/wiki/Foo_(bar)")])).toEqual({
      urls: ["https://en.wikipedia.org/wiki/Foo_(bar)"],
      note: "read",
    });
  });

  it("adds https to scheme-less entity urls", () => {
    const t = "github.com/a/b";
    expect(extractLinks(t, [ent(t, "github.com/a/b")]).urls).toEqual(["https://github.com/a/b"]);
  });

  it("dedupes within one message", () => {
    const t = "https://x.com/a/status/1 https://x.com/a/status/1";
    expect(extractLinks(t, undefined).urls).toEqual(["https://x.com/a/status/1"]);
  });

  it("returns a null note when the message is only a link", () => {
    const t = "https://example.com/post";
    expect(extractLinks(t, [ent(t, t)])).toEqual({ urls: ["https://example.com/post"], note: null });
  });

  it("returns nothing for text without links", () => {
    expect(extractLinks("just words", undefined)).toEqual({ urls: [], note: "just words" });
    expect(extractLinks(undefined, undefined)).toEqual({ urls: [], note: null });
  });
});

describe("normalizeUrl", () => {
  it("rejects non-web and malformed urls", () => {
    expect(normalizeUrl("javascript:alert(1)")).toBeNull();
    expect(normalizeUrl("ftp://example.com/x")).toBeNull();
    expect(normalizeUrl("localhost")).toBeNull();
  });

  it("does not strip trailing punctuation (only the regex fallback does)", () => {
    expect(normalizeUrl("https://en.wikipedia.org/wiki/Foo_(bar)")).toBe("https://en.wikipedia.org/wiki/Foo_(bar)");
    expect(normalizeUrl(" https://a.com/x. ")).toBe("https://a.com/x.");
  });
});

describe("detectSource", () => {
  it.each([
    ["https://vt.tiktok.com/ZS1/", "tiktok"],
    ["https://www.tiktok.com/@a/video/1", "tiktok"],
    ["https://www.instagram.com/reel/X/", "instagram"],
    ["https://youtu.be/abc", "youtube"],
    ["https://m.youtube.com/watch?v=1", "youtube"],
    ["https://www.threads.net/@a/post/1", "threads"],
    ["https://www.threads.com/@a/post/1", "threads"],
    ["https://www.linkedin.com/posts/a", "linkedin"],
    ["https://x.com/a/status/1", "x"],
    ["https://twitter.com/a/status/1", "x"],
    ["https://github.com/a/b", "github"],
    ["https://example.com/", "other"],
    ["https://eviltiktok.com/", "other"],
    ["not a url", "other"],
  ])("%s → %s", (url, source) => {
    expect(detectSource(url)).toBe(source);
  });
});

describe("extractTag", () => {
  it("takes *name out of the note, lowercased", () => {
    expect(extractTag("*Brand deep")).toEqual({ tag: "brand", note: "deep" });
    expect(extractTag("deep *brand2")).toEqual({ tag: "brand2", note: "deep" });
    expect(extractTag("hook  *home  idea")).toEqual({ tag: "home", note: "hook idea" });
    expect(extractTag("*brand")).toEqual({ tag: "brand", note: null });
    expect(extractTag("*brand, look at the hook")).toEqual({ tag: "brand", note: ", look at the hook" });
  });

  it("first match wins; later tags stay in the note", () => {
    expect(extractTag("*brand *home")).toEqual({ tag: "brand", note: "*home" });
  });

  it("does not match markdown bold or italics", () => {
    expect(extractTag("**bold** text")).toEqual({ tag: null, note: "**bold** text" });
    expect(extractTag("an *italic* word")).toEqual({ tag: null, note: "an *italic* word" });
  });

  it("needs start or whitespace before the star", () => {
    expect(extractTag("a*b")).toEqual({ tag: null, note: "a*b" });
    expect(extractTag("example.com/x*brand")).toEqual({ tag: null, note: "example.com/x*brand" });
  });

  it("needs the name to end at a word boundary in any script", () => {
    expect(extractTag("*brandтут").tag).toBeNull();
    expect(extractTag("*brandé x").tag).toBeNull();
    expect(extractTag("*brand тут")).toEqual({ tag: "brand", note: "тут" });
    expect(extractTag("тут *brand")).toEqual({ tag: "brand", note: "тут" });
  });

  it("needs the last character to be a letter or digit", () => {
    expect(extractTag("*brand- x").tag).toBeNull();
    expect(extractTag("*brand x").tag).toBe("brand");
    expect(extractTag("*a").tag).toBe("a");
  });

  it("rejects bad names: leading hyphen, too long, other characters", () => {
    expect(extractTag("*-brand").tag).toBeNull();
    expect(extractTag(`*${"a".repeat(33)}`).tag).toBeNull();
    expect(extractTag(`*${"a".repeat(32)}`).tag).toBe("a".repeat(32));
    expect(extractTag("*бренд").tag).toBeNull();
    expect(extractTag("*brand_x").tag).toBeNull();
    expect(extractTag(null)).toEqual({ tag: null, note: null });
  });

  it("never reads a tag out of a link, since links leave the note first", () => {
    const t = "https://example.com/a*brand/ *home";
    const { urls, note } = extractLinks(t, undefined);
    expect(urls).toEqual(["https://example.com/a*brand/"]);
    expect(extractTag(note)).toEqual({ tag: "home", note: null });
    expect(extractTag(extractLinks("https://example.com/ *x*", undefined).note).tag).toBeNull();
  });
});
