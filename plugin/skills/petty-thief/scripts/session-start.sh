#!/bin/sh
# SessionStart hook: tells Claude how many links wait in the stash.
# Prints nothing and exits 0 on any problem, so a session never waits on or breaks because of the stash.
pt_lib="$(dirname "$0")/lib.sh"
[ -r "$pt_lib" ] || exit 0
. "$pt_lib" || exit 0

# remind: false (also no/off) in ./.petty-thief/profile.yaml keeps this hook silent.
# ~/.petty-thief/profile.yaml sets the global default; a remind line in the project file wins.
pt_remind() {
  [ -r "$1" ] || return 0
  sed -n 's/^[[:space:]]*remind:[[:space:]]*["'"'"']\{0,1\}\([A-Za-z]*\).*$/\1/p' "$1" 2>/dev/null | head -n 1 | tr 'A-Z' 'a-z'
}
remind=$(pt_remind "./.petty-thief/profile.yaml")
[ -n "$remind" ] || remind=$(pt_remind "$HOME/.petty-thief/profile.yaml")
case "$remind" in false | no | off) exit 0 ;; esac

pt_load_config 2>/dev/null || exit 0
# Count only this project's links: its stash_tag ones (plus untagged unless take_untagged is false),
# or without stash_tag only untagged ones. A bad stash_tag keeps the hook silent; stash.sh explains it.
pt_tag_filter 2>/dev/null || exit 0
n=$(pt_curl 3 "$PT_URL/api/count?${PT_TAG_QUERY#&}" 2>/dev/null | sed -n 's/.*"waiting":\([0-9][0-9]*\).*/\1/p')
[ -n "$n" ] || exit 0

# Stay quiet when nothing changed: speak only if the count differs from the last one seen,
# or the last reminder is more than a day old. This saves usage on Claude Pro.
# One state per tag, so projects with different tags sharing ~/.petty-thief do not silence each other.
state="$(dirname "$PT_CONFIG")/.last-reminder${PT_TAG:+-$PT_TAG}"
now=$(date +%s)
last_n=""
last_t=0
[ -f "$state" ] && read -r last_n last_t < "$state" 2>/dev/null
# Only a plain number counts. Strip leading zeros so sh never reads it as octal,
# and ignore anything longer than 11 digits so the arithmetic cannot overflow.
case "$last_t" in '' | *[!0-9]*) last_t=0 ;; esac
last_t=${last_t#"${last_t%%[!0]*}"}
case "$last_t" in '' | ????????????*) last_t=0 ;; esac
case "$now" in '' | *[!0-9]*) exit 0 ;; esac
age=$((now - last_t))
# A timestamp from the future (clock change, tampered file) counts as expired.
if [ "$n" = "$last_n" ] && [ "$age" -ge 0 ] && [ "$age" -lt 86400 ]; then
  exit 0
fi
printf '%s %s\n' "$n" "$now" > "$state" 2>/dev/null
[ "$n" = 0 ] && exit 0

where="in the stash"
[ -n "$PT_TAG" ] && where="for *$PT_TAG"
printf '{"hookSpecificOutput":{"hookEventName":"SessionStart","additionalContext":"Petty Thief: %s link(s) waiting %s. Early in the conversation, at a natural moment, offer to go through them with the petty-thief skill."}}\n' "$n" "$where"
exit 0
