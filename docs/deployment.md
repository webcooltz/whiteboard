# Running it permanently (for example on a Raspberry Pi)

The server needs only Node 20 or newer. Build the Angular app on a laptop and copy it over.

```bash
npm run build
rsync -a dist server package.json  pi@raspberrypi:/opt/whiteboard/     # or any copy method
```

Then on the Pi, put your settings in `/opt/whiteboard/.env` (copy `.env.example`), create the service user and install
`deploy/whiteboard.service` (instructions are in its header; `/etc/whiteboard.env` from `deploy/whiteboard.env.example`
works too, and wins over `.env`). systemd restarts the server after crashes and on boot. The board is
saved to disk after every stroke, so a power cut loses at most the stroke in progress.

Your data lives in the `data/` folder (or wherever `DATA_DIR` points): the live board, saved boards, the activity log
and the session secret. Back that folder up if the board matters to you.

## Wall displays

On each display Pi, copy `deploy/pi/kiosk.sh` to `~/whiteboard/` with a `.env` next to it holding `WHITEBOARD_URL`
(`http://localhost:8080` if the server runs on the same Pi) and `BOARD_PASSWORD`, and optionally `WHITEBOARD_NAME`.
Start it at login (`deploy/pi/whiteboard-kiosk.desktop` is an autostart template). It waits for the server, opens
Chromium full-screen, signs in by itself, and reconnects automatically if the network or server drops.

- `READ_ONLY=1` makes a screen that only shows the board.
- `DEVICE_KEY` (from `BOARD_DEVICE_KEYS`) signs in with a fixed name instead of the password.
- Touchscreens draw like any other input, and the layout is tuned for the 800×480 Pi touchscreen.

The kiosk passes the password to the browser in the URL hash, which is never sent over the network, but it is visible
to anyone with a shell on that Pi.

## Backups

Erasing or loading a board saves an automatic backup first (named `auto before clear …` or `auto before load …`).
The 10 newest are kept, and you can open them from the Boards list.
