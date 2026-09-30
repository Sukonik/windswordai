# Free alpha hosting: Render Free + Supabase Free

Same address and same browser-only experience (`https://windswordai.onrender.com`, Settings → Connections). Only the storage behind it changes.

```
Browser -> Render Free server -> Supabase Free table (windsword_state) -> saved setup
```

Why: Render Free machines restart and sleep and their local files are not permanent. Supabase is the permanent filing cabinet.

## One-time setup (all in the browser)
1. **Supabase**: create a free project → SQL Editor → paste `docs/supabase-setup.sql` → Run.
2. Supabase → Project Settings → API: copy the **Project URL** and the **secret key** (`service_role` / `sb_secret_…`). Never the anon/publishable key, and never paste it into chat or GitHub.
3. **Render**: New → Blueprint → this repo → Apply (free plan). When it asks for `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`, paste them there. (Existing service: Environment tab → add both.)
4. Render → Environment: copy `WINDSWORD_ADMIN_TOKEN`.
5. Open `https://windswordai.onrender.com/settings/#connections`, enter the admin code, Google Sign-In → paste Client ID + Secret → Save → Test Connection.

## What is stored where
| Data | Where | Protection |
|---|---|---|
| Google Client Secret, provider keys, OAuth tokens | Supabase `windsword_state` (`vault`) | AES-256-GCM ciphertext; the key is `WINDSWORD_VAULT_KEY` in Render, so a Supabase leak alone reveals nothing |
| Client ID, connection status | Supabase (`connect`, `connections`) | public / non-secret |
| Users, sessions | Supabase (`users`, `sessions`) | sessions stored only as SHA-256 hashes |
| Audit trail | Render logs | fixed fields only: no secrets, prompts or emails |

The table has row-level security on and no policies, and the public keys are revoked: only the server's secret key can read it. The server refuses to start on Supabase without `WINDSWORD_VAULT_KEY`, or if Supabase cannot be read (so it never starts "empty" and overwrites real data).

## Trade-offs
- Free Render sleeps when idle; the first visit afterwards is slower. Sessions survive because they live in Supabase.
- Single instance only (in-memory cache, write-through). Don't scale to several instances on this setup.
- **Do not change `WINDSWORD_VAULT_KEY`** after saving secrets, or they become unreadable and must be re-entered.
- Free Supabase projects pause after a week of inactivity; visiting the app (or any request) keeps it awake, and a paused project can be resumed from the Supabase dashboard.
