# PR 03B — Account-linking UX and the OAuth connector

The gateway stays mandatory infrastructure, but it becomes invisible plumbing. The normal experience is: **pick an AI, press Connect, come back connected.**

## What users see

- **Settings → AI Connections:** one card per provider (Claude, ChatGPT, Muse, Gemini, Mistral, Ollama, in registry priority order), one obvious action each (`Connect Claude`, `Use local Ollama`), status badge, and a collapsed **Details** section (connection type, usage source, privacy, models, policy). No gateway URL, token, base URL or API jargon in the normal view.
- **Connect sheet** (bottom sheet on phones, dialog on desktop, same component everywhere):
  - Provider with account linking configured: **Continue to <vendor>** first, with "Use a developer key instead" underneath.
  - Otherwise: **Connect developer account** (key field, honest billing note from the provider descriptor, "Where do I find this?" link, collapsed *Custom endpoint*).
  - Ollama: **Detect local models**, no login.
  - Public demo: explains that accounts can't be connected there.
- **Chat uses the same flow.** Provider chip → pick a provider that isn't connected (`Gemini — connect`) → the sheet opens in place. After a key connect the provider is selected; after an OAuth redirect the browser returns to the same route, **the conversation and draft are restored** (`sessionStorage`), and the provider is selected. If it is connected but Secure Local blocks it, a banner says so with **Switch to Standard**.
- **Compare keeps both identities:** each column shows the provider mark, name and model.
- **Advanced connection settings** (collapsed): gateway URL, gateway token, diagnostics. Hosted deployments configure the gateway URL automatically (`NEXT_PUBLIC_GATEWAY_URL`), so ordinary users never see it. `/settings/#advanced` opens it.
- Provider marks are neutral monograms. **Official vendor marks are not drawn or approximated**; drop licensed assets in and swap `ProviderMark` when available.

## The OAuth contract (generic, per provider by configuration)

```text
Connect  ->  POST /v1/connections/<id>/oauth/start {returnTo}      (bearer token if the gateway has one)
             <-  { authorizeUrl }   (state + PKCE S256 challenge stored server-side, 10 min, single use)
Browser  ->  provider authorization page (official, the user signs in there)
Provider ->  GET /oauth/callback/<id>?code=…&state=…               (protected by state + PKCE, not a header)
Gateway  ->  validates state (single use, provider-bound, unexpired), exchanges the code with the PKCE
             verifier (+ client secret if configured) server-side, probes models with the bearer token,
             stores the tokens ENCRYPTED in the vault, records only an opaque reference
         ->  302 to the sanitized returnTo (+ ?connected=<id> or ?connect_error=<id>)
Chat     ->  Gateway.resolveCredential(): refreshes an expiring access token once (concurrent calls share
             one refresh), re-stores it encrypted, presents it as `Authorization: Bearer`
Disconnect -> revoke at the provider (best effort) + delete local token material
```

Security properties (all covered by tests): Authorization Code + PKCE (S256); random single-use, provider-bound, expiring state; `returnTo` restricted to same-site relative paths (no open redirect); tokens never in the browser, `localStorage`, API responses, audit, logs or vault plaintext; refresh/access tokens server-side only; no cookie/session scraping.

### Enabling a provider (environment only, no code)

```text
WINDSWORD_OAUTH_<ID>_CLIENT_ID        required          (ID = CLAUDE, OPENAI, GEMINI, META, MISTRAL, …)
WINDSWORD_OAUTH_<ID>_SCOPES           required          space or comma separated. Never guessed.
WINDSWORD_OAUTH_<ID>_AUTHORIZE_URL    required*         *Gemini defaults to Google's endpoints
WINDSWORD_OAUTH_<ID>_TOKEN_URL        required*
WINDSWORD_OAUTH_<ID>_CLIENT_SECRET    optional
WINDSWORD_OAUTH_<ID>_REVOKE_URL       optional          (Gemini defaults to Google's)
WINDSWORD_OAUTH_<ID>_BASE_URL         optional          API base the adapter should call once linked
WINDSWORD_OAUTH_<ID>_EXTRA_PARAMS     optional          JSON of extra authorize params
WINDSWORD_PUBLIC_URL                  hosted            public base URL used to build redirect URIs
```

The redirect URI to register with the provider is `<public-url>/oauth/callback/<id>`. A provider only offers **Continue to …** when all required values are present; otherwise its sheet shows the developer-key path.

## Provider reality (what is actually true today)

| Provider | Today | Notes |
| --- | --- | --- |
| Claude | Developer key ✔ | Account linking is **not** enabled: no documented delegated flow for third-party apps has been verified. The subscription (Agent SDK) path stays `planned`. The connector will light up from config if Anthropic exposes a suitable flow. |
| ChatGPT | Developer key ✔ | "Continue with ChatGPT" is identity only; it does not grant model usage. Model access stays a separate connection. |
| Gemini | Developer key ✔ · **OAuth wired** | The connector and Gemini's bearer-token path are implemented and tested end-to-end against a fake authorization server. **Not verified against real Google:** which scopes authorize Gemini API calls for a third-party app, and whether Google's app verification applies, must be confirmed in Google's docs before setting `WINDSWORD_OAUTH_GEMINI_SCOPES`. |
| Muse | Developer key ✔ (base URL required) | OAuth only if Meta exposes a delegated flow (config-enabled). |
| Mistral | Developer key ✔ | OAuth only if offered (config-enabled). |
| Ollama | Local, no login ✔ | |

## WindSwordAI sign-in ("Continue with Google") — designed, not built here

Signing into WindSwordAI and connecting an AI provider are separate: Google sign-in creates the WindSwordAI identity; **Connect Gemini** separately grants model access.

Plan (plain Google Identity Services; Firebase/Auth0/Clerk stay optional later without touching the provider registry):

1. Google Cloud project + OAuth client (web); authorized JavaScript origin = the hosted WindSwordAI origin. *Needs the owner to create the client id.*
2. UI: the Google button (GIS) returns an ID token (credential) to the page.
3. `POST /v1/auth/google {credential}`: verify the RS256 signature against Google's JWKS, check `iss`, `aud` = our client id, `exp`, and `email_verified`; find/create the user by `sub`.
4. Set an opaque, random, server-stored session in an `HttpOnly; Secure; SameSite=Lax` cookie (no tokens in `localStorage`); add CSRF protection for state-changing calls; `POST /v1/auth/logout`.
5. **Scope connections per user.** Today connections and the vault are single-user (the local install). Hosted use needs `userId`-scoped connection/secret stores and per-user audit before any second person uses one gateway.
6. Alpha: an email allow-list.

This lands after the hosted HTTPS deployment (PR 03A), because the session cookie and the OAuth redirect URIs both need the real public origin.

## Tests and evidence

- `tests/gateway-oauth.test.mjs`: PKCE verified by a fake authorization server, state replay/wrong-provider/expiry, open-redirect protection, refresh (including concurrent), failed refresh, revoke on disconnect, token secrecy, env parsing (scopes never guessed), HTTP start/callback routes.
- `npm run review:gateway`: real UI + real gateway + fake vendors + fake OAuth server (84 checks) including the connect sheet, Advanced-settings-hidden, account linking, chat inline connect with conversation restore, denial, compare identities, and secrecy checks on browser storage, audit, vault and logs.
- `npm run review:responsive`: connect sheet fit/focus/Escape/scroll-lock, touch targets, provider picker.

## Known limitations

- Not run against real Google/Anthropic/OpenAI authorization servers (no credentials or registered clients here).
- No vendor currently offers a verified delegated-model-access flow that this PR enables by default; only the mechanism and Gemini's bearer path exist.
- Official provider logos are not included (monograms).
- Chat restore after an OAuth redirect keeps completed turns and the draft; an in-flight streaming reply is marked "Interrupted while connecting".
