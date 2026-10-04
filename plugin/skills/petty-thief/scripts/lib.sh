# Shared helpers for Petty Thief scripts. Sourced by stash.sh and session-start.sh, not run directly.

pt_config_path() {
  if [ -n "${PETTY_THIEF_CONFIG:-}" ]; then
    printf '%s\n' "$PETTY_THIEF_CONFIG"
  elif [ -f "./.petty-thief/config.json" ]; then
    printf '%s\n' "./.petty-thief/config.json"
  else
    printf '%s\n' "$HOME/.petty-thief/config.json"
  fi
}

# Sets PT_URL and PT_TOKEN. Returns 1 when the config is missing or broken.
pt_load_config() {
  PT_CONFIG=$(pt_config_path)
  [ -f "$PT_CONFIG" ] || return 1
  PT_URL=$(sed -n 's/^ *"url": *"\([^"]*\)".*$/\1/p' "$PT_CONFIG")
  PT_TOKEN=$(sed -n 's/^ *"token": *"\([^"]*\)".*$/\1/p' "$PT_CONFIG")
  [ -n "$PT_URL" ] && [ -n "$PT_TOKEN" ]
}

# pt_curl <max-seconds> <curl args...>
# Prints the response body and returns 0 on HTTP 2xx. On any other status, prints
# "petty-thief: HTTP <code>" and the start of the body to stderr and returns 1.
# The status is appended with -w and split off here, which works on any curl with -H @- (7.55+).
# The token goes through stdin (-H @-), so it never shows up in the process list.
pt_curl() {
  pt_max=$1
  shift
  pt_out=$(printf 'Authorization: Bearer %s\n' "$PT_TOKEN" | curl -sS -m "$pt_max" -H @- -w '\n%{http_code}' "$@") || return 1
  pt_code=$(printf '%s\n' "$pt_out" | tail -n 1)
  pt_body=$(printf '%s\n' "$pt_out" | sed '$d')
  case "$pt_code" in
    2??)
      printf '%s\n' "$pt_body"
      ;;
    *)
      printf 'petty-thief: HTTP %s %s\n' "$pt_code" "$(printf '%s' "$pt_body" | tr '\n' ' ' | head -c 200)" >&2
      return 1
      ;;
  esac
}

# Escapes a string for a JSON string literal. Newlines, tabs and CRs become spaces;
# every other control character (which JSON forbids raw) is dropped.
pt_json_escape() {
  printf '%s' "$1" | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g' | tr '\n\r\t' '   ' | tr -d '\000-\010\013\014\016-\037'
}

# pt_one_line <value>: returns 1 when the value contains a newline or a carriage return.
# grep -E checks match line by line, so every validated value must pass this first.
pt_one_line() {
  case "$1" in
    *"
"* | *"$(printf '\r')"*) return 1 ;;
  esac
  return 0
}

# pt_profile_value <key>: the value of `key:` in ./.petty-thief/profile.yaml if that file has the key,
# else in ~/.petty-thief/profile.yaml (the project file wins, even with an empty value). A trailing
# # comment, surrounding spaces and quotes are dropped, the value is lowercased, and `null` or `~`
# become empty. Prints nothing when neither file has the key.
# The value is NOT validated here: callers must check it before using it anywhere.
pt_profile_value() {
  for pt_f in "./.petty-thief/profile.yaml" "$HOME/.petty-thief/profile.yaml"; do
    [ -r "$pt_f" ] || continue
    grep -Eq "^[[:space:]]*$1:" "$pt_f" 2>/dev/null || continue
    pt_v=$(sed -n "s/^[[:space:]]*$1:[[:space:]]*\([^#]*\).*\$/\1/p" "$pt_f" 2>/dev/null | head -n 1 |
      sed -e 's/[[:space:]]*$//' -e "s/^[\"']\(.*\)[\"']\$/\1/" | tr 'A-Z' 'a-z')
    case "$pt_v" in null | "~") pt_v="" ;; esac
    printf '%s\n' "$pt_v"
    return 0
  done
  return 0
}

# pt_tag_filter: sets PT_TAG (the project's stash_tag, or empty) and PT_TAG_QUERY, the query string
# for /api/count and /api/items:
#   stash_tag set:  "&tag=<name>&untagged=1", or "&untagged=0" with take_untagged false/no/off/0;
#   no stash_tag:   "&untagged=only" (this project takes only links sent without a *tag).
# An empty `stash_tag:` in the project profile means "no tag here" and does not fall back to the global one.
# Returns 1 when stash_tag is set but is not a valid name, so it never reaches a url.
pt_tag_filter() {
  PT_TAG=$(pt_profile_value stash_tag)
  PT_TAG_QUERY="&untagged=only"
  [ -n "$PT_TAG" ] || return 0
  pt_valid_tag "$PT_TAG" || return 1
  case "$(pt_profile_value take_untagged)" in
    false | no | off | 0) PT_TAG_QUERY="&tag=$PT_TAG&untagged=0" ;;
    *) PT_TAG_QUERY="&tag=$PT_TAG&untagged=1" ;;
  esac
}

# pt_valid_tag <name>: 1-32 lowercase letters, digits or hyphens, first and last a letter or digit.
pt_valid_tag() {
  pt_one_line "$1" && printf '%s' "$1" | grep -Eq '^[a-z0-9]([a-z0-9-]{0,30}[a-z0-9])?$'
}
