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

## Local setup (real Google): paste the secret in a form
1. Run `npm run start:local` and open **http://localhost:8787/setup/google** (this computer only).
2. Paste the Google Client Secret into the password field (the Client ID is pre-filled if known, otherwise paste it too), keep "Require Google sign-in" ticked, click **Save secret**.
3. Sign-in switches on immediately (no restart). Open http://localhost:8787 and click **Continue with Google**.

How the page protects the secret: only reachable from this machine (loopback socket, `localhost` Host header, no proxy headers; disabled when `WINDSWORD_PUBLIC_URL` is a public host), one-time page token + Origin check, masked field, never echoed back, never logged or audited (only "saved"), not in URL/cookies/browser storage.
It is stored in the encrypted vault (AES-256-GCM, `.windsword/vault.json`); `.windsword/local-config.json` holds only the public client id, a vault reference and the sign-in switch. Both are git-ignored. Environment variables (`.env`, host Secrets) still win when set. Anyone with access to your OS account can reach the page, the same trust boundary as a `.env` file.

Hosted: use the host's Secrets/Environment Variables interface instead (the page is refused there by design).

## How it works
- Authorization Code + PKCE (S256) + `nonce`, performed server-side; single-use state; login-CSRF binding cookie `ws_login`.
- ID token verified: RS256 only, Google JWKS (cached, refetched on unknown `kid`), `iss`, `aud`/`azp`, `exp`, `iat`, `nonce`, `sub`, `email`, `email_verified`.
- Opaque server-side sessions: cookie holds a random id, only `sha256(id)` is stored. Cookie is `HttpOnly; SameSite=Lax` (+ `Secure`, `__Host-` when https). Not readable by page JS.
- CSRF: `x-csrf-token` plus Origin check on cookie-authenticated POST/DELETE.
- Per-user scoping: connections, vault entries, OAuth links and audit view are keyed by an opaque user id. Environment API keys are ignored in `required` mode; each user connects their own.
- Audit: `auth.login`, `auth.login_failed`, `auth.logout` with opaque user ids; never emails or tokens.

## Verification
`npm test` (unit + repo-hygiene secret scan) and `npm run review:auth` (real UI + gateway + fake Google issuing real RS256 ID tokens; 49 checks at 390 and 1440 px). Real-Google behaviour is **not** verified until the secret is supplied locally.
