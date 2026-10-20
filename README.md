# ERLC Dashboard

Live server stats website. The Express backend holds your ERLC key, caches results for 10 seconds, and serves a static page that refreshes automatically.
https%3A%2F%2Fgithub.com%2Fyoum821%2Fvirify%2Fblob%2Fmain%2Flanding.html
## Run it
1. `cd dashboard && npm install`
2. `cp .env.example .env` and fill in `ERLC_SERVER_KEY` and `STAFF_KEY`
3. `npm start`, then open http://localhost:3000

If the verification bot runs in the folder above, the dashboard reads its `verify.db` (read-only) to show the verified member count.

## Put it online
This needs a Node host (the key must stay on a server), so a static host won't work. Options: Render, Railway, Fly.io, or a small VPS. Set the same variables from `.env` in the host's settings. If the bot and dashboard run on separate hosts, drop the `DB_PATH` line and the verified card simply won't show.

## Notes
- Public endpoints expose player names and teams only. Join logs, mod calls, and kill logs require the staff key.
- Use HTTPS in production, since the staff key is sent in a header.
- Confirm endpoints and rate limits against the official ERLC API docs.
