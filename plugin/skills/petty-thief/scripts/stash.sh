#!/bin/sh
# Petty Thief stash client.
# Usage:
#   printf '%s\n' '<token>' | stash.sh connect <url>    (the token is read from stdin, never from arguments)
#   stash.sh host                                      (prints the connected url, never the token)
#   stash.sh count                                     (only this project's links, see below)
#   stash.sh list [waiting|done|skipped] [limit] [tag] (limit 1-200, default 20; same filter)
#   stash.sh tags                                      (waiting links per tag: "<tag> <n>" lines)
#   stash.sh clear-chat                                (delete the last 48 h of the Telegram chat; the stash stays)
#   stash.sh webhook                                   (re-register the bot with Telegram: fixes a silent bot or dead buttons)
# count and list follow stash_tag and take_untagged from ./.petty-thief/profile.yaml, else
# ~/.petty-thief/profile.yaml: with stash_tag, the links tagged for it (plus untagged ones unless
# take_untagged is false). Without stash_tag, only links sent without a *tag.
# list's third argument asks for exactly the links tagged <tag> instead ("take them here").
#   stash.sh done <id> [lens] [summary] [file]
#   stash.sh skip <id> [reason]
set -u
. "$(dirname "$0")/lib.sh"

die() {
  echo "petty-thief: $*" >&2
  exit 1
}

need_config() {
  pt_load_config || die "not connected. Send /connect to your Telegram bot and paste its message into Claude Code."
}

need_tag_filter() {
  pt_tag_filter || die "stash_tag in profile.yaml must be 1-32 lowercase letters, digits or hyphens, starting with a letter or digit (for example: stash_tag: brand)"
}

check_id() {
  pt_one_line "$1" && printf '%s' "$1" | grep -Eq '^[a-z0-9]{1,40}$' || die "that item id looks wrong"
}

# https only, with a plain host and no shell-special characters, so the url can never
# carry a command into a later shell line. Plain http only for a local test server.
URL_PATH='(/[^[:space:]'\''"$`\\]*)?$'
URL_HTTPS='^https://[A-Za-z0-9.-]+(:[0-9]+)?'
URL_LOCAL='^http://(127\.0\.0\.1|localhost)(:[0-9]+)?'
check_url() {
  pt_one_line "$1" || return 1
  printf '%s' "$1" | grep -Eq "$URL_HTTPS$URL_PATH" || printf '%s' "$1" | grep -Eq "$URL_LOCAL$URL_PATH"
}

cmd=${1:-}
[ $# -gt 0 ] && shift

case "$cmd" in
  connect)
    [ $# -eq 1 ] || die "usage: stash.sh connect <url>, with the token on stdin (never as an argument)"
    url=${1%/}
    token=""
    IFS= read -r token || true
    # A token pasted on Windows or through Git Bash can end in a carriage return.
    token=$(printf '%s' "$token" | tr -d '\r')
    check_url "$url" || die "the url looks wrong. It must start with https:// and contain no spaces or quotes."
    pt_one_line "$token" && printf '%s' "$token" | grep -Eq '^pt_[A-Za-z0-9]{32}$' || die "the token looks wrong. Copy the whole message from /connect."
    f=$(pt_config_path)
    mkdir -p "$(dirname "$f")"
    (umask 077 && printf '{\n  "url": "%s",\n  "token": "%s"\n}\n' "$url" "$token" > "$f")
    chmod 600 "$f"
    pt_load_config || die "could not read back $f"
    n=$(pt_curl 15 "$PT_URL/api/count" | sed -n 's/.*"waiting":\([0-9][0-9]*\).*/\1/p')
    [ -n "$n" ] || die "saved the connection, but the bot did not answer. Check the url, or send /connect again for a fresh key."
    echo "Connected. $n links waiting."
    ;;
  host)
    pt_load_config || exit 1
    printf '%s\n' "$PT_URL"
    ;;
  count)
    need_config
    need_tag_filter
    out=$(pt_curl 15 "$PT_URL/api/count?${PT_TAG_QUERY#&}") || die "could not reach your stash"
    printf '%s\n' "$out" | sed -n 's/.*"waiting":\([0-9][0-9]*\).*/\1/p'
    ;;
  list)
    need_config
    status=${1:-waiting}
    limit=${2:-20}
    case "$status" in waiting|done|skipped) ;; *) die "status must be waiting, done or skipped" ;; esac
    pt_one_line "$limit" && printf '%s' "$limit" | grep -Eq '^[0-9]{1,3}$' && [ "$limit" -ge 1 ] && [ "$limit" -le 200 ] || die "limit must be 1 to 200"
    need_tag_filter
    if [ $# -ge 3 ]; then
      pt_valid_tag "$3" || die "tag must be 1-32 lowercase letters, digits or hyphens"
      PT_TAG_QUERY="&tag=$3&untagged=0"
    fi
    pt_curl 15 "$PT_URL/api/items?status=$status&limit=$limit$PT_TAG_QUERY" || die "could not reach your stash"
    ;;
  tags)
    need_config
    out=$(pt_curl 15 "$PT_URL/api/count?by_tag=1") || die "could not reach your stash"
    # {"waiting":N,"tagged":{"home":2,...}}. The worker only stores valid names, and this keeps only
    # pairs that look like one, so nothing else from the response is printed.
    printf '%s\n' "$out" | sed -n 's/.*"tagged":{\([^}]*\)}.*/\1/p' | tr ',' '\n' |
      sed -n 's/^"\([a-z0-9][a-z0-9-]*\)":\([0-9][0-9]*\)$/\1 \2/p'
    ;;
  clear-chat)
    need_config
    out=$(pt_curl 30 -X POST "$PT_URL/api/chat/clear") || die "could not clear the chat"
    printf '%s\n' "$out" | sed -n 's/.*"cleared":\([0-9][0-9]*\).*/Cleared \1 messages. The stash is untouched./p'
    ;;
  webhook)
    need_config
    out=$(pt_curl 20 -X POST "$PT_URL/api/webhook") || die "the bot could not re-register with Telegram"
    printf '%s\n' "$out" | sed -n 's/.*"telegram":"\([^"]*\)".*/Telegram: \1/p'
    ;;
  done)
    need_config
    [ $# -ge 1 ] || die "usage: stash.sh done <id> [lens] [summary] [file]"
    check_id "$1"
    body=$(printf '{"lens":"%s","summary":"%s","file":"%s"}' "$(pt_json_escape "${2:-}")" "$(pt_json_escape "${3:-}")" "$(pt_json_escape "${4:-}")")
    pt_curl 15 -X POST -H 'content-type: application/json' --data-binary "$body" "$PT_URL/api/items/$1/done" || die "could not mark $1 as done"
    ;;
  skip)
    need_config
    [ $# -ge 1 ] || die "usage: stash.sh skip <id> [reason]"
    check_id "$1"
    body=$(printf '{"reason":"%s"}' "$(pt_json_escape "${2:-}")")
    pt_curl 15 -X POST -H 'content-type: application/json' --data-binary "$body" "$PT_URL/api/items/$1/skip" || die "could not skip $1"
    ;;
  *)
    die "usage: stash.sh connect|host|count|list|tags|clear-chat|webhook|done|skip (see the top of this file)"
    ;;
esac
