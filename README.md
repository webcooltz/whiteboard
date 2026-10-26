# Whiteboard

A permanent, shared, live whiteboard. A few people (or wall displays such as Raspberry Pis) open the same
board and draw on it together — with a mouse, touch, a pen, or the keyboard. It is password protected,
remembers the board across restarts, lets you save and erase boards, and keeps a log of who did what.

```
 browsers / Raspberry Pi kiosks  ──WebSocket──▶  server/ (Node, no npm dependencies)  ──▶  data/
        Angular app in src/                      login · live sync · audit log             board.journal
                                                                                            boards/*.json
                                                                                            audit.log
```

## Quick start

```bash
npm install
npm run build                      # builds the Angular app into dist/whiteboard
BOARD_PASSWORD='a long password' npm run server
# open http://localhost:8080
```

The server refuses to start with no password configured, so the board is never accidentally open.

For development run the server as above and `npm start` (Angular dev server on :4200, proxied to :8080).

## Signing in

| Mode | How | Log identities |
|---|---|---|
| Shared password | set `BOARD_PASSWORD` (or `BOARD_PASSWORD_HASH`) | the name each person types (self-declared) |
| Per-person passwords | `npm run add-user -- Alice` (creates `data/users.json`) | verified |
| Wall display / Pi | `BOARD_DEVICE_KEYS=pi-kitchen=<16+ chars>` | `pi-kitchen (device)` |

Passwords are stored as scrypt hashes. Repeated failed sign-ins lock that name and address out for 15 minutes.
Sessions are signed tokens valid for 30 days; sign-ins use HTTP, so on anything beyond a trusted home network
put the server behind HTTPS (Caddy, nginx, or Tailscale) and set `TRUST_PROXY=1`.

## Using the board

* **Draw:** mouse, touch and pen all work. Tools: pen / marker, eraser, line (solid, dotted, dashed), spray paint.
* **Keyboard:** Tab to the board, arrows move the cursor (Shift = big steps, Alt = small), Space or Enter starts and
  stops drawing, Esc stops, Ctrl+Z undoes.
* **Undo** removes *your own* last stroke, never somebody else's.
* **Save board…** stores a named copy. **Saved boards** lists them (who saved, when) to load or delete.
* **Erase board** clears it for everyone. A backup (`auto before clear …`) is saved first, so an accidental erase
  is one click to undo. Loading a board also backs up the current one. The 10 newest automatic backups are kept.
* **Download PNG** exports the board.
* **Activity** shows the audit log: sign-ins (including failed ones), who drew, undid, saved, loaded, erased, deleted.
  It is also on disk at `data/audit.log` (one JSON object per line, rotated at 5 MB).

## Running it permanently (e.g. on a Raspberry Pi)

The server needs only Node 20+ — build the Angular app on a laptop and copy it over.

```bash
npm run build
rsync -a dist server package.json  pi@raspberrypi:/opt/whiteboard/     # or any copy method
```

Then on the Pi: create the service user, install `deploy/whiteboard.service` and `deploy/whiteboard.env.example`
(instructions are in the file headers). systemd restarts the server after crashes and on boot. The board is
journalled to disk after every stroke, so a power cut loses at most the stroke in progress.

**Wall displays:** on each display Pi, copy `deploy/pi/kiosk.sh`, set `WHITEBOARD_URL` and that Pi's `DEVICE_KEY`,
and start it at login (`deploy/pi/whiteboard-kiosk.desktop` is an autostart template). It opens Chromium full-screen,
signs in with the device key, and reconnects automatically if the network or server drops. Use `READ_ONLY=1`
for a screen that only shows the board. Touchscreens draw like any other input.

## Tests

```bash
npm run test:server    # 15 tests: auth, lockout, sync, validation, undo, save/erase/load, audit log, persistence
npm run test:e2e       # real Chromium + real server: mouse/touch/pen/keyboard drawing stays identical on every screen
                       # (needs Playwright:  npm i --no-save playwright && npx playwright install chromium)
npm test               # Angular unit tests
```

## How it works

* The board is a list of **strokes**. Drawing sends small `begin` / `points` / `end` messages; everyone replays them,
  so screens of any size show the same picture (board coordinates are a fixed 1600×900, scaled to fit).
* Spray paint is seeded, so its dots land in the same place on every screen.
* The server validates every message, rate-limits each connection, and only accepts WebSocket connections from its
  own origin.
* Limits: 100,000 strokes per board, 20 simultaneous connections.

## Not built yet

Redo, text and shape tools, multiple simultaneous boards (there is one live board; saved boards are snapshots),
and an admin role (anyone signed in can erase — but it is backed up and logged).
