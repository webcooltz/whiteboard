# Whiteboard

A shared whiteboard that stays on. Open it in a browser, sign in, and everyone sees each other draw in real time.
Good for a family fridge, a team wall display, or a classroom.

![The board, with notes, stickers and drawings](docs/screenshots/board.png)

## What you can do

- **Draw together, live.** Pen, pencil, marker, highlighter, crayon, spray paint, lines and an eraser, with any color.
- **Add text and stickers.** Type a text box (with an optional background color), click it again later to edit it, or stamp an emoji sticker.
- **Undo and redo your own changes.** Never someone else's.
- **Keep your boards.** Save named copies, open them again, or download the board as a PNG.
- **Works on any screen.** Mouse, touch, pen or keyboard, on a phone, laptop or wall display.
- **Safe to leave running.** Password protected, remembers the board after a restart, backs up before erasing,
  and keeps a log of who did what.

<table>
  <tr>
    <td width="68%"><img src="docs/screenshots/editing.png" alt="Editing a text box and choosing its background"></td>
    <td><img src="docs/screenshots/phone.png" alt="The board on a phone"></td>
  </tr>
  <tr>
    <td align="center">Click a text box to change its text, color, size or background</td>
    <td align="center">Everything fits on one phone screen</td>
  </tr>
</table>

## Quick start

You need [Node.js](https://nodejs.org) 20 or newer.

```bash
npm install
npm run build
cp .env.example .env     # Windows: copy .env.example .env
```

Open `.env` and set `BOARD_PASSWORD` to something long, then:

```bash
npm run server
```

Visit <http://localhost:8080>, enter a name and the password, and start drawing. Anyone who opens the same address
(on your network) sees the same board. The server won't start without a password, so it is never left open by accident.

## Using it

| | |
|---|---|
| **Tools** | Pick one on the left, or press `1`–`9` and `0`. `[` and `]` change the size. |
| **Text** | Pick Text and click the board. `Enter` places it, `Shift+Enter` adds a line, `Esc` cancels. Click an existing box to edit it; clear the text to delete it. |
| **Stickers** | Pick Sticker, choose an emoji, click to stamp it. |
| **Undo / redo** | `Ctrl+Z` / `Ctrl+Y` (or the top bar). |
| **Save / Boards** | Save a named copy, then open or delete saved boards from the Boards list. |
| **Erase** | Clears the board for everyone, after saving an automatic backup you can open from Boards. |
| **Activity** | Shows who signed in, drew, undid, saved or erased, and when. |
| **Keyboard only** | `Tab` to the board, arrow keys move the cursor, `Space` draws or places. |

## Signing in

By default everyone shares one password and picks their own name. For more control you can instead give each person
their own password, or give a wall display its own key. See [Signing in and security](docs/signing-in.md).

## Put it on a Raspberry Pi or a server

The server is plain Node with no extra packages, so it runs happily on a Raspberry Pi. See
[Running it permanently](docs/deployment.md) for the service setup and for wall displays that open the board by themselves.

## For developers

```bash
npm start                # Angular dev server on :4200 (proxies to the board server on :8080)
npm run test:server      # server tests: sign-in, sync, validation, text edits, undo/redo, saving, persistence
npm test                 # Angular unit tests
npm run test:e2e         # drawing in a real browser against a real server (needs Playwright)
```

- `src/` is the Angular app. `src/app/board/` holds the drawing code, which has no Angular in it.
- `server/` is the Node server: sign-in, live sync over WebSockets, and saving to `data/`.
- The board is a list of strokes (a brush stroke, a text box or a sticker). Each change is sent as a small message and every
  screen redraws it the same way, so all screens match. The board is 1600×900 and scaled to fit.
- The server checks every message, limits how fast each connection can send, and only accepts connections from its own address.

**Not built yet:** shape tools, moving a text box after placing it, pressure sensitivity, several live boards at once
(saved boards are snapshots), and an admin role (anyone signed in can erase, but it's backed up and logged).
