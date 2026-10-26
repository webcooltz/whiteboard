#!/bin/bash
# Full-screen whiteboard on a Raspberry Pi (or any Linux box with Chromium).
# Settings come from the .env file next to this script (or the file in WHITEBOARD_ENV):
#   WHITEBOARD_URL    e.g. http://192.168.1.20:8080 (http://localhost:8080 if the server runs on this Pi)
#   BOARD_PASSWORD    the board password: the kiosk signs in with it, so people only enter their name
#   WHITEBOARD_NAME   optional: the name to start with (it can be changed on screen)
#   DEVICE_KEY        optional instead of BOARD_PASSWORD: a key from BOARD_DEVICE_KEYS (fixed name, no name box)
#   READ_ONLY=1       optional: show the board but ignore touches (a pure display)
set -u
ENV_FILE="${WHITEBOARD_ENV:-$(dirname "$(readlink -f "$0")")/.env}"
# Read KEY=value lines the same way the server does (# comments, optional quotes; nothing is executed).
# Variables already set in the environment win.
if [ -f "$ENV_FILE" ]; then
  while IFS= read -r line || [ -n "$line" ]; do
    line=${line%$'\r'}
    [[ $line =~ ^[[:space:]]*(export[[:space:]]+)?([A-Za-z_][A-Za-z0-9_]*)[[:space:]]*=[[:space:]]*(.*)$ ]] || continue
    key=${BASH_REMATCH[2]} val=${BASH_REMATCH[3]}
    if [[ $val =~ ^\"(.*)\"[[:space:]]*$ || $val =~ ^\'(.*)\'[[:space:]]*$ ]]; then val=${BASH_REMATCH[1]}
    else val=${val%%[[:space:]]#*}; val=${val%"${val##*[![:space:]]}"}; fi
    [ -z "${!key+x}" ] && export "$key=$val"
  done < "$ENV_FILE"
fi
: "${WHITEBOARD_URL:?set WHITEBOARD_URL in $ENV_FILE, e.g. http://192.168.1.20:8080}"

urlencode() {
  local LC_ALL=C s="$1" out="" c i
  for ((i = 0; i < ${#s}; i++)); do
    c=${s:i:1}
    case "$c" in [a-zA-Z0-9.~_-]) out+="$c" ;; *) printf -v c '%%%02X' "'$c"; out+="$c" ;; esac
  done
  printf '%s' "$out"
}

# The secret goes in the URL *hash*, which browsers never send over the network; the app stores it and
# removes it from the address bar.
if [ -n "${DEVICE_KEY:-}" ]; then
  HASH="display&key=$(urlencode "$DEVICE_KEY")"
elif [ -n "${BOARD_PASSWORD:-}" ]; then
  HASH="display&pw=$(urlencode "$BOARD_PASSWORD")"
else
  echo "set BOARD_PASSWORD (or DEVICE_KEY) in $ENV_FILE"; exit 1
fi
[ -n "${WHITEBOARD_NAME:-}" ] && HASH="${HASH}&name=$(urlencode "$WHITEBOARD_NAME")"
[ "${READ_ONLY:-0}" = "1" ] && HASH="${HASH}&ro"

# Wait for the server to be reachable (the Pi may boot before the network or the server is up).
until curl -fsS -m 3 "$WHITEBOARD_URL/api/health" >/dev/null 2>&1; do sleep 3; done

BROWSER=$(command -v chromium-browser || command -v chromium || true)
[ -n "$BROWSER" ] || { echo "Chromium not found (sudo apt install chromium-browser)"; exit 1; }

exec "$BROWSER" --kiosk --noerrdialogs --disable-infobars --disable-session-crashed-bubble \
  --no-first-run --password-store=basic --touch-events=enabled --overscroll-history-navigation=0 \
  --user-data-dir="$HOME/.config/whiteboard-kiosk" \
  "${WHITEBOARD_URL}/#${HASH}"
