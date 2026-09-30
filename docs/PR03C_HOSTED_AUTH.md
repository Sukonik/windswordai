# PR03C — WindSwordAI sign-in ("Continue with Google")

Identity only. Signing in tells WindSwordAI *who you are*. It grants **no** access to Google Drive, Gemini or any other Google service.

## What Google is asked for
Only `openid email profile`. Google Drive / BYO-Storage and Gemini are separate, later connections with their own OAuth clients and consent screens
(`GOOGLE_DRIVE_CLIENT_*`, `GEMINI_GOOGLE_CLIENT_*`), never reusing the login client.

## Configuration (all server-side)
| Variable | Purpose |
|---|---|
| `WINDSWORD_AUTH` | `off` (default, single-user local) or `required` (sign-in gate, per-user data) |
| `WINDSWORD_GOOGLE_CLIENT_ID` | Public OAuth client ID |
| `WINDSWORD_GOOGLE_CLIENT_SECRET` | **Secret.** Private ignored `.env` locally, host Secrets in production. Never committed, logged or sent to the browser |
| `WINDSWORD_AUTH_ALLOWED_EMAILS` | Optional allow-list: emails or `@domain`. Empty = any verified Google account |
| `WINDSWORD_SESSION_TTL_HOURS` | Session lifetime (default 168) |
| `WINDSWORD_PUBLIC_URL` | Public https origin (turns on `Secure` + `__Host-` cookie) |

Registered with Google (project "WindSwordAI", External/Testing, Web application):
- JavaScript origins: `http://localhost:8787`, `http://127.0.0.1:8787`
- Redirect URIs: `http://localhost:8787/oauth/callback/google`, `http://127.0.0.1:8787/oauth/callback/google`

Google only accepts `https` redirect URIs (or `localhost`). LAN `http://192.168…` addresses cannot sign in; the gateway shows an explanatory page.
**When the hosted https gateway exists**, add its exact origin and `<origin>/oauth/callback/google` to the Google OAuth client. The UI must be served from the gateway origin so the session cookie is first-party.

## WindSword Connect: set up in the browser (Settings → Connections)
No terminal, no `.env` editing. Connections are defined as data (`gateway/src/connect/definitions.ts`): id, name, category (Identity / AI Providers / Storage / Local Services) and fields (`text`, `url`, `password`, `select`, `checkbox`; each marked `secret` or public), plus optional `apply`, `test`, `clear`. One generic screen (`components/ConnectionsPanel.tsx`) and one generic store render and save every connection; Google Sign-In is the first definition. Adding Dropbox, Drive, S3/R2 means adding a definition.

Flow: open WindSwordAI → Settings → Connections → Google Sign-In → **Connect/Manage** → Client ID + Client Secret → **Save** → **Test Connection**. Statuses: Connected ✓, Ready, Needs setup, Connection error, Admin disabled. The technical Google addresses are under **Advanced**.

Secrets: masked field, never preloaded, never returned (the browser only gets `secretsSet: true`), "Secret saved ✓" + explicit **Replace secret**, **Remove connection** kept separate. Stored in the encrypted vault (`.windsword/vault.json`); public values (Client ID) in `.windsword/connect.json`. Nothing in URLs, localStorage, logs, audit (only "saved / tested / removed" + connection id) or the static build.

Who can use it: on the computer running the gateway (loopback only; proxied/foreign-Host requests refused), or hosted at the https public URL after **administrator access**: the code in `WINDSWORD_ADMIN_TOKEN` (HttpOnly Strict cookie, 30 min, 5 wrong codes lock 10 min) and/or a signed-in Google account listed in `WINDSWORD_ADMIN_EMAILS`. Without either, hosted setup is off ("Admin disabled"). Writes need a CSRF token and same-origin. Old `/setup` links redirect to Settings → Connections. Environment variables still win when set.

## How it works
- Authorization Code + PKCE (S256) + `nonce`, performed server-side; single-use state; login-CSRF binding cookie `ws_login`.
- ID token verified: RS256 only, Google JWKS (cached, refetched on unknown `kid`), `iss`, `aud`/`azp`, `exp`, `iat`, `nonce`, `sub`, `email`, `email_verified`.
- Opaque server-side sessions: cookie holds a random id, only `sha256(id)` is stored. Cookie is `HttpOnly; SameSite=Lax` (+ `Secure`, `__Host-` when https). Not readable by page JS.
- CSRF: `x-csrf-token` plus Origin check on cookie-authenticated POST/DELETE.
- Per-user scoping: connections, vault entries, OAuth links and audit view are keyed by an opaque user id. Environment API keys are ignored in `required` mode; each user connects their own.
- Audit: `auth.login`, `auth.login_failed`, `auth.logout` with opaque user ids; never emails or tokens.

## Verification
`npm test` (unit + repo-hygiene secret scan) and `npm run review:auth` (real UI + gateway + fake Google issuing real RS256 ID tokens; 49 checks at 390 and 1440 px). Real-Google behaviour is **not** verified until the secret is supplied locally.

## Credential handoff (alpha): GitHub Repository Secrets
See [GITHUB_SECRETS_HANDOFF.md](GITHUB_SECRETS_HANDOFF.md). Hosting is not decided yet; nothing here requires it.
