export type Source = "tiktok" | "instagram" | "youtube" | "threads" | "linkedin" | "x" | "github" | "other";

/** A Telegram message entity. Offsets are UTF-16 code units, the same as JS string indices. */
export interface Entity {
  type: string;
  offset: number;
  length: number;
  url?: string;
}

export interface Extracted {
  urls: string[];
  note: string | null;
}

const SOURCES: [RegExp, Source][] = [
  [/(^|\.)tiktok\.com$/, "tiktok"],
  [/(^|\.)(instagram\.com|instagr\.am)$/, "instagram"],
  [/(^|\.)(youtube\.com|youtu\.be)$/, "youtube"],
  [/(^|\.)threads\.(net|com)$/, "threads"],
  [/(^|\.)(linkedin\.com|lnkd\.in)$/, "linkedin"],
  [/(^|\.)(x\.com|twitter\.com|t\.co)$/, "x"],
  [/(^|\.)github\.com$/, "github"],
];

export function detectSource(url: string): Source {
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return "other";
  }
  for (const [re, source] of SOURCES) if (re.test(host)) return source;
  return "other";
}

/** Validates and normalizes one URL. It never strips punctuation: entity URLs are exact. */
export function normalizeUrl(raw: string): string | null {
  const trimmed = raw.trim();
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    const u = new URL(withScheme);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    if (!u.hostname.includes(".")) return null;
    return u.toString();
  } catch {
    return null;
  }
}

const URL_RE = /\bhttps?:\/\/[^\s<>"]+/gi;

export function extractLinks(text: string | undefined, entities: Entity[] | undefined): Extracted {
  const t = text ?? "";
  const found: string[] = [];
  const spans: [number, number][] = [];
  const linkEntities = (entities ?? []).filter((e) => e.type === "url" || e.type === "text_link");

  for (const e of linkEntities) {
    if (e.type === "url") {
      found.push(t.slice(e.offset, e.offset + e.length));
      spans.push([e.offset, e.offset + e.length]);
    } else if (e.url) {
      found.push(e.url);
    }
  }
  if (linkEntities.length === 0) {
    for (const m of t.matchAll(URL_RE)) {
      // Only here, in free text, is trailing punctuation probably not part of the URL.
      const clean = m[0].replace(/[)\].,!?;:'"»]+$/, "");
      found.push(clean);
      spans.push([m.index!, m.index! + clean.length]);
    }
  }

  const urls: string[] = [];
  for (const raw of found) {
    const url = normalizeUrl(raw);
    if (url && !urls.includes(url)) urls.push(url);
  }

  let rest = "";
  let pos = 0;
  for (const [start, end] of spans.sort((a, b) => a[0] - b[0])) {
    rest += `${t.slice(pos, start)} `;
    pos = end;
  }
  rest += t.slice(pos);
  const note = rest.replace(/\s+/g, " ").trim();
  return { urls, note: note || null };
}

/** A project name: 1 to 32 lowercase letters, digits and hyphens, starting and ending with a letter or digit. */
export const TAG_NAME_RE = /^[a-z0-9](?:[a-z0-9-]{0,30}[a-z0-9])?$/;

// `*name` at the start or after whitespace, so `**bold**`, `a*b` and `/x*y` inside text never match.
// The name must end there: any further letter in any script (`*brandтут`), digit, `_`, `-` or a
// closing `*` (as in `*italic*`) means it is not a tag. The `u` flag makes \p{L} and \s Unicode-aware.
const TAG_RE = /(^|\s)\*([a-z0-9](?:[a-z0-9-]{0,30}[a-z0-9])?)(?![\p{L}\p{N}\p{M}_*-])/iu;

export interface Tagged {
  tag: string | null;
  note: string | null;
}

/** Takes the first project tag out of a note. The tag is lowercased and removed from the note text. */
export function extractTag(note: string | null): Tagged {
  if (!note) return { tag: null, note };
  const m = note.match(TAG_RE);
  if (!m) return { tag: null, note };
  const rest = (note.slice(0, m.index!) + m[1] + note.slice(m.index! + m[0].length)).replace(/\s+/g, " ").trim();
  return { tag: m[2].toLowerCase(), note: rest || null };
}
