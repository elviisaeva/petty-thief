# Content formats

Detect the format after the link type. Signals, in order:
1. oEmbed `type` (`video`, `photo`, `rich`);
2. `og:type` and `og:video`;
3. the number of `og:image` tags (2 or more usually means a carousel);
4. platform fields (TikTok `photo` posts, Instagram `/p/` vs `/reel/`);
5. the user's note.

If the signals disagree, say "format unclear: <best guess>".

| Format | Tier 0 (no login) | Tier 1 (gentle mode) | Tier 2 (download, with a yes) |
|---|---|---|---|
| Text post or thread | Full text from the page or oEmbed | Replies and comments | Not needed |
| Image carousel | Caption and cover image only | Screenshot each slide, 3–5 s apart | Download the slide images |
| Single image | Caption and the `og:image` (download to a temp folder, view, delete) | Comments | Not needed |
| Article with images | Full text. Key images viewed directly, alt text read. | Paywalled text if the user is subscribed | Not needed |
| Video with speech | Caption and cover. YouTube: the public transcript. | Screenshot every 2 s | Subtitles only (`yt-dlp --write-subs --write-auto-subs --skip-download`), or the video, then frames and whisper |
| Video with burned-in text, no speech | Caption and cover | Screenshot every 2 s, read the on-screen text | Frames at 1 fps, read the on-screen text |
| Profile | Bio, counts and recent items as shown publicly | Pinned posts, recent formats | Not needed |

## Seen line
Every analysis file has a `Seen:` line right under the title, listing what you actually looked at and what you did not, for example: `Seen: caption, cover · Not seen: slides 2–8, comments`.

Never describe parts listed under "Not seen". When whisper finds no speech, write "no speech (music or sound only)" and rely on frames and on-screen text.
