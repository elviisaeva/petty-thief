# Gentle mode

Read and follow this before ANY step that uses the user's logged-in browser session on any platform. Without gentle mode, no login is used.

The goal: no platform ever suspects automation or limits the user's account. Behave like a person calmly scrolling.

## Before
- Ask the user which account to use. If the platform has several, remind them to switch, and wait for "ok". Never switch accounts yourself.
- Open one new tab and close it when done.

## Watch only
- Never like, follow, save, comment, share or message.
- No scripts on the platform: no injected JavaScript, no internal API calls, no loops, no access to page storage.
- Only what a person does: open, look (screenshots, zoom), read text, scroll, click.

## Pace and limits
| | Per session | Per day |
|---|---|---|
| Profiles | 10 | 20 |
| Posts or videos | 20 | 40 |

- 45–60 seconds between profiles and between videos.
- 3–5 seconds between carousel slides.
- A failed click is retried once, then reported.
- Open only what the current step needs. Nothing "just in case".

## Stop signals
Stop ALL work on that platform, retry nothing, and tell the user right away if you see:
- HTTP 429, "Try again later", "We restrict certain activity", "Too many requests";
- a captcha or puzzle, an identity check, a forced re-login;
- pages that usually load and now don't.

Log it in `<petty-thief dir>/signals.md`: date, platform, what you saw. Do not use that platform logged in again until the next day. Check `signals.md` before any tier 1 step.

## Defaults
TikTok and Instagram show captchas to automated browsers quickly. For them, prefer tier 0, then tier 2 with consent, over tier 1.
