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
wrangler secret put SETLISTFM_KEY             # optional: setlist lookup (free key at setlist.fm/settings/api)
wrangler secret put YOUTUBE_KEY               # optional: finds a YouTube match for imported Spotify tracks (YouTube Data API v3)
wrangler secret put ANTHROPIC_API_KEY         # optional: poster scanning (paid, capped at 15 scans per user per day)
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

- `/api/e`, `/api/follow`, `/api/feed`, `/api/setlist`: the music diary (gigs and festivals, album ratings and reviews, lists, following friends, setlists from setlist.fm).

- `/api/meta`: title, artist and cover for a pasted YouTube or SoundCloud link (official oEmbed, no key needed).
- `/api/resolve`: finds a YouTube video for an imported track and caches it in D1 so each song is looked up once (200 lookups per user per day).
- `/api/poster`: reads a poster image and returns the acts, date and venue.
- `/api/profile`: avatar, banner and bio.
- `public/welcome.html`: landing page at `/welcome`. To make it the home page, move the player to its own path or rename the files.

## Playing from other platforms
YouTube, SoundCloud and Spotify tracks play through each service's **official embedded player** (kept visible, as their terms require). Spotify's embed plays 30-second previews unless the listener is signed in to Spotify Premium in that browser. The equalizer and audio-reactive visuals only work with your own files, because embedded players don't expose their audio.

## Updating an existing deployment
```bash
wrangler d1 execute drift --remote --file=schema.sql   # safe to re-run, adds the new tables
wrangler deploy
```

## Privacy
People you follow can see your gigs and album ratings, and "Also there" only shows people you follow. Lists are private.

## Known limits
- Drift never streams audio. Imported playlists and rooms match tracks by "Artist - Title", so each listener needs the same file name in their own library.
- Check Spotify's current developer terms and API access rules for playlist data before relying on import.
- Rooms need a logged-in user. Password reset isn't built.
