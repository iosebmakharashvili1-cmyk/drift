# Drift: web player + server

One Cloudflare Worker serves the page (`public/index.html`) and the API (`src/index.js`).
Without the server the page still works as a local player. Lyrics lookup, accounts, link import and rooms switch on automatically when `/api` answers.

## Deploy
```bash
npm i -g wrangler && wrangler login
wrangler d1 create drift                      # copy database_id into wrangler.toml
wrangler d1 execute drift --remote --file=schema.sql
wrangler secret put SPOTIFY_ID                # optional: link import
wrangler secret put SPOTIFY_SECRET            # (create an app at developer.spotify.com)
wrangler deploy
```
Then add a custom domain in the Cloudflare dashboard (Workers > drift > Settings > Domains).
Local test: `wrangler dev` (use `--remote` for D1).

## What each part does
- `/api/lyrics`: looks up time-synced lyrics on LRCLIB (cached 24h) when a track has none.
- `/api/signup|login|logout|me`: username + password (PBKDF2), HttpOnly session cookie, 30 days.
- `/api/library`: stores playlists and likes per account; the page syncs automatically.
- `/api/import`: Spotify track/album/playlist link -> playlist of "Artist|Title" entries.
- `/api/rooms`: a Durable Object per room, up to 50 listeners; the host's playback state is broadcast, guests follow; emoji reactions.

## Known limits
- Drift never streams audio. Imported playlists and rooms match tracks by "Artist - Title", so each listener needs the same file name in their own library.
- Check Spotify's current developer terms and API access rules for playlist data before relying on import.
- Rooms need a logged-in user. Password reset isn't built.
