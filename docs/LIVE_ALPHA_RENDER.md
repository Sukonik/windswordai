# Live alpha: Render Free

GitHub Pages stays the public demo. Render Free is the real alpha backend and Google login: one server serves the app and the gateway at `https://windswordai.onrender.com`.

- Google Authorized JavaScript origin: `https://windswordai.onrender.com`
- Google Authorized redirect URI: `https://windswordai.onrender.com/oauth/callback/google`
- Runtime secret: Render → windswordai → **Environment** → `WINDSWORD_GOOGLE_CLIENT_SECRET` (paste once). The Client ID is public and already set in `render.yaml`.

Steps (browser only): merge → render.com → New → Blueprint → this repo → Apply → when asked, paste `WINDSWORD_GOOGLE_CLIENT_SECRET` → wait for "Live" → open the URL and click Continue with Google.

Alpha trade-offs (accepted): the free service sleeps after ~15 min idle (about a minute to wake) and keeps no permanent files, so sessions and locally saved AI-provider connections can reset; people may need to sign in again. No database, no persistent disk. The Connections screen (Settings) stays available for later; it is not needed for this test (set `WINDSWORD_ADMIN_TOKEN` in Render if you want to use it).
