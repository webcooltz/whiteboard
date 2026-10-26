#!/bin/bash
# Full-screen whiteboard on a Raspberry Pi (or any Linux box with Chromium).
#   WHITEBOARD_URL   e.g. http://192.168.1.20:8080
#   DEVICE_KEY       the key for this Pi from BOARD_DEVICE_KEYS
#   READ_ONLY=1      optional: show the board but ignore touches (a pure display)
set -u
: "${WHITEBOARD_URL:?set WHITEBOARD_URL, e.g. http://192.168.1.20:8080}"
: "${DEVICE_KEY:?set DEVICE_KEY to this display's key}"

# Wait for the server to be reachable (the Pi may boot before the network or the server is up).
until curl -fsS -m 3 "$WHITEBOARD_URL/api/health" >/dev/null 2>&1; do sleep 3; done

BROWSER=$(command -v chromium-browser || command -v chromium || true)
[ -n "$BROWSER" ] || { echo "Chromium not found (sudo apt install chromium-browser)"; exit 1; }

# The key goes in the URL *hash*, which browsers never send over the network.
HASH="display&key=${DEVICE_KEY}"
[ "${READ_ONLY:-0}" = "1" ] && HASH="${HASH}&ro"

exec "$BROWSER" --kiosk --noerrdialogs --disable-infobars --disable-session-crashed-bubble \
  --no-first-run --password-store=basic --touch-events=enabled --overscroll-history-navigation=0 \
  --user-data-dir="$HOME/.config/whiteboard-kiosk" \
  "${WHITEBOARD_URL}/#${HASH}"
