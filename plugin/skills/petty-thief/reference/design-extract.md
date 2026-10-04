# Extracting a design reference

Tag every fact: `from CSS`, `from HTML`, `from image (histogram)`, `estimated from image`, or `not visible`. Never invent hex values or font names.

Work in `tmp=$(mktemp -d)`. `"$tmp"` is your own variable and may stay in double quotes; every URL (the page, a stylesheet `href`, the `og:image`) is untrusted and goes in single quotes with each `'` replaced by `'\''` (SKILL.md → Safety rules). Resolve relative stylesheet links to full `https://` URLs before fetching, and skip any that contain a newline or NUL. **Never Read the downloaded HTML or CSS files.** Only look at the output of the `grep` commands below, each capped with `head`.

## Live sites (and Awwwards: follow its "Visit site" link)
1. `curl -sL -m 20 '<url>' -o "$tmp/page.html"`. List the stylesheets with `grep -o '<link[^>]*stylesheet[^>]*>' "$tmp/page.html" | head -5` and fetch at most 5 into `$tmp/`, one per command: `curl -sL -m 20 '<stylesheet url>' -o "$tmp/1.css"`. Inline `<style>` blocks stay in `page.html`.
2. **Colors:** run `grep -Eoh '#[0-9a-fA-F]{3,8}\b|rgba?\([^)]*\)' "$tmp"/*.css "$tmp/page.html" | sort | uniq -c | sort -rn | head -12`, and look at `--*color*` and `--*brand*` custom properties. Keep the top 8 with their role → `from CSS`.
3. **Fonts:** `grep -Eoh 'font-family:[^;}]*|@font-face|fonts\.googleapis\.com[^"]*|use\.typekit\.net[^"]*|fonts\.bunny\.net[^"]*' "$tmp"/*.css "$tmp/page.html" | sort | uniq -c | sort -rn | head -10` → `from CSS`.
4. **Layout and spacing:** `grep -Eoh '(max-width|grid-template-columns|gap|border-radius):[^;}]*|@media[^{]*' "$tmp"/*.css "$tmp/page.html" | sort | uniq -c | sort -rn | head -20`. On Tailwind sites, read class names instead: `grep -Eoh 'max-w-[a-z0-9]+|gap-[0-9]+|rounded-[a-z0-9]+|grid-cols-[0-9]+' "$tmp/page.html" | sort | uniq -c | sort -rn | head -12` → `from HTML`.
5. View the `og:image` for mood and patterns: `curl -sL -m 20 -o "$tmp/og" '<og:image url>'`, open it, delete it.

## Image-only sources (Dribbble, Behance, Pinterest, Mobbin)
- One fetch: title, author, `og:image`. Download it with `curl -sL -m 20 -o "$tmp/img" '<og:image url>'`.
- **Palette:** if `magick` exists, run `magick "$tmp/img" -resize 200x200 -colors 8 -format %c histogram:info:` → `from image (histogram)`. Otherwise give approximate hex values marked `estimated from image`.
- **Fonts:** describe the style; never name a font.
- **403 or login wall:** write the card with title, note and cover, plus "extraction unavailable: login wall". Do not retry.
- **Tier 0 only** for these platforms in v1, whatever the profile says. For Mobbin, ask the user to paste a screenshot and extract `from image`.
- `rm -rf "$tmp"` at the end.
