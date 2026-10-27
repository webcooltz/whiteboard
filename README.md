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
cp .env.example .env               # then set BOARD_PASSWORD in .env  (Windows: copy .env.example .env)
npm run server
# open http://localhost:8080
```

Settings live in `.env` in the project folder (see `.env.example`; real environment variables override it, and
`ENV_FILE=/path/to/file` points the server at another file). `.env` holds the board password, so it is not committed.
The server refuses to start with no password configured, so the board is never accidentally open.

For development run the server as above and `npm start` (Angular dev server on :4200, proxied to :8080).

## Signing in

| Mode | How | Log identities |
|---|---|---|
| Shared password | set `BOARD_PASSWORD` (or `BOARD_PASSWORD_HASH`) in `.env` | the name each person types (self-declared) |
| Per-person passwords | `npm run add-user -- Alice` (creates `data/users.json`) | verified |
| Wall display / Pi | `BOARD_DEVICE_KEYS=pi-kitchen=<16+ chars>` | `pi-kitchen (device)` |

With the shared password, a browser asks for the password once; after that it stays signed in (30 days) and only
asks for a name. The Pi kiosk reads the password from its `.env` and signs in by itself, so a Pi only ever shows the
"your name" box (or nothing at all, if `WHITEBOARD_NAME` is set). Click your name in the top right to change it.

Passwords are stored as scrypt hashes. Repeated failed sign-ins lock that name and address out for 15 minutes.
Sessions are signed tokens valid for 30 days; sign-ins use HTTP, so on anything beyond a trusted home network
put the server behind HTTPS (Caddy, nginx, or Tailscale) and set `TRUST_PROXY=1`.

## Using the board

* **Draw:** mouse, touch and pen all work. Brushes: pen (smooth ink), pencil, marker, highlighter (see-through),
  crayon, spray paint, line (solid, dashed, dotted), eraser. Pick a color swatch (or any color with the picker) and a size.
* **Text:** pick Text, click the board and type. Enter places it, Shift+Enter adds a line, Esc cancels. Color and size apply.
* **Stickers:** pick Sticker, choose one from the grid, click to stamp it. The size slider sets how big.
  Text and stickers undo, redo, erase, save and export like any stroke.
* **Shortcuts:** `1`–`9` and `0` pick a tool, `[` / `]` change the size, Ctrl+Z undoes, Ctrl+Y (or Ctrl+Shift+Z) redoes.
* **Keyboard drawing:** Tab to the board, arrows move the cursor (Shift = big steps, Alt = small), Space or Enter
  starts and stops drawing (or places a text box / sticker), Esc stops.
* **Undo** removes *your own* last stroke, never somebody else's. **Redo** puts back what you undid (until you draw something new).
* **Save** stores a named copy. **Boards** lists them (who saved, when) to open or delete.
* **Erase** clears it for everyone. A backup (`auto before clear …`) is saved first, so an accidental erase
  is one click to undo. Loading a board also backs up the current one. The 10 newest automatic backups are kept.
* **PNG** downloads the board as an image.
* **Activity** shows the audit log: sign-ins (including failed ones), who drew, undid, saved, loaded, erased, deleted.
  It is also on disk at `data/audit.log` (one JSON object per line, rotated at 5 MB).

## Running it permanently (e.g. on a Raspberry Pi)

The server needs only Node 20+ — build the Angular app on a laptop and copy it over.

```bash
npm run build
rsync -a dist server package.json  pi@raspberrypi:/opt/whiteboard/     # or any copy method
```

Then on the Pi: put your settings in `/opt/whiteboard/.env` (copy `.env.example`), create the service user and install
`deploy/whiteboard.service` (instructions are in its header; `/etc/whiteboard.env` from `deploy/whiteboard.env.example`
works too, and wins over `.env`). systemd restarts the server after crashes and on boot. The board is
journalled to disk after every stroke, so a power cut loses at most the stroke in progress.

**Wall displays:** on each display Pi, copy `deploy/pi/kiosk.sh` to `~/whiteboard/` with a `.env` next to it holding
`WHITEBOARD_URL` (`http://localhost:8080` if the server runs on the same Pi) and `BOARD_PASSWORD`, optionally
`WHITEBOARD_NAME`. Start it at login (`deploy/pi/whiteboard-kiosk.desktop` is an autostart template). It waits for
the server, opens Chromium full-screen, signs in by itself and reconnects automatically if the network or server drops.
Use `READ_ONLY=1` for a screen that only shows the board, or `DEVICE_KEY` (from `BOARD_DEVICE_KEYS`) instead of the
password for a screen with a fixed name. Touchscreens draw like any other input; the layout is tuned for the 800×480
Pi touchscreen. (The kiosk passes the password to the browser in the URL hash, which is never sent over the network,
but it is visible to anyone with a shell on that Pi.)

## Tests

```bash
npm run test:server    # 20 tests: auth, rename, .env, lockout, sync, validation, text/stickers, undo/redo, save/erase/load, audit, persistence
npm run test:e2e       # real Chromium + real server: mouse/touch/pen/keyboard drawing stays identical on every screen
                       # (needs Playwright:  npm i --no-save playwright && npx playwright install chromium)
npm test               # Angular unit tests
```

## How it works

* The board is a list of **strokes**. Drawing sends small `begin` / `points` / `end` messages; everyone replays them,
  so screens of any size show the same picture (board coordinates are a fixed 1600×900, scaled to fit).
* Textured brushes (pencil, crayon, spray) are seeded, so they look identical on every screen. Pen, pencil, crayon,
  spray and eraser paint point by point as they grow; marker, highlighter and lines are drawn as one path (previewed
  while you draw), so see-through ink doesn't darken where it overlaps itself.
* The server validates every message, rate-limits each connection, and only accepts WebSocket connections from its
  own origin.
* Limits: 100,000 strokes per board, 20 simultaneous connections.

## Not built yet

Shape tools, moving or editing text after it is placed, pressure sensitivity, multiple simultaneous boards (there is one live board; saved boards are snapshots),
and an admin role (anyone signed in can erase — but it is backed up and logged).
