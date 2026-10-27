# Signing in and security

| Mode | How to set it up | Names in the activity log |
|---|---|---|
| Shared password (default) | set `BOARD_PASSWORD` (or `BOARD_PASSWORD_HASH`) in `.env` | the name each person types |
| Per-person passwords | `npm run add-user -- Alice` (creates `data/users.json`) | verified names |
| Wall display / Raspberry Pi | `BOARD_DEVICE_KEYS=pi-kitchen=<16+ characters>` | `pi-kitchen (device)` |

With the shared password, a browser asks for the password once and then stays signed in for 30 days; after that it only
asks for a name. Click your name in the top right to change it (this keeps your undo history). Per-person and device
names are fixed and can't be changed.

## Settings

Settings live in `.env` in the project folder (see `.env.example`). Real environment variables override it, and
`ENV_FILE=/path/to/file` points the server at another file. `.env` holds the password, so it is not committed to git.

## Security notes

- Passwords are stored as scrypt hashes. Repeated failed sign-ins lock that name and address out for 15 minutes.
- Sessions are signed tokens valid for 30 days.
- Sign-in uses plain HTTP, so on anything beyond a trusted home network put the server behind HTTPS
  (Caddy, nginx or Tailscale) and set `TRUST_PROXY=1`.
- The server validates every message, rate-limits each connection, and only accepts WebSocket connections from its own origin.
- Limits: 100,000 strokes per board and 20 simultaneous connections.
