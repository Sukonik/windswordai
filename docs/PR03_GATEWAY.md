# PR 03 — Provider Gateway, Chat Runtime & Secure Local Mode

Implements Issue #3. The chat UI talks **only** to a WindSwordAI gateway. It never calls a model vendor.

```text
 Chat / Compare UI            (browser)
        │   SSE                 holds only: gateway URL + token, execution mode, model choice
        ▼
 WindSwordAI Gateway          gateway/  (Node 22, TypeScript, zero dependencies)
        │
        ├─ Policy gate ──────── the single data-egress decision point (gateway/src/policy.ts)
        ├─ Audit log ────────── metadata only, fixed field allowlist (gateway/src/audit.ts)
        ├─ Provider registry ── descriptor + adapter, re-orderable/disable-able at runtime
        │      ├─ Claude / Anthropic ......... adapter: anthropic.ts
        │      ├─ OpenAI / ChatGPT ........... adapter: openai-compat.ts
        │      ├─ Meta Muse (Model API) ...... adapter: openai-compat.ts (needs base URL)
        │      ├─ Google Gemini .............. adapter: gemini.ts
        │      ├─ Mistral .................... adapter: openai-compat.ts
        │      ├─ Ollama (local) ............. adapter: ollama.ts
        │      └─ Demo (mock) ................ adapter: mock.ts (CI + public demo)
        └─ Auth connectors ──── api_key (encrypted vault) · local · subscription/OAuth (planned)
                                 credentials are resolved inside the gateway, never passed from UI state
```

## Run it (working version)

```bash
npm install
npm run start:local          # builds the UI and starts the gateway on http://127.0.0.1:8787
# open http://127.0.0.1:8787  →  Settings → AI Connections → paste a Claude or OpenAI API key
```

- Default mode is **Secure Local**: cloud providers are visibly disabled. Switch to **Standard** (toolbar pill or Settings) to use connected cloud providers for general prompts.
- Ollama needs no account: start Ollama, open Settings, and its models appear.
- Other devices on your network: `WINDSWORD_HOST=0.0.0.0 npm run gateway`. A random bearer token is generated and printed; enter it under Settings → Gateway. The server refuses to bind beyond loopback without one.
- Public Pages site: stays a **synthetic demo**. It uses an in-browser mock provider through the same policy code and cannot connect accounts (a static site cannot hold secrets).
- Try it with no keys: `npm run fake-providers` starts fake Anthropic/OpenAI-shaped upstreams; connect Claude with key `sk-fake-claude-000111` and base URL `http://127.0.0.1:9911`, OpenAI with `sk-fake-openai-000222` and base URL `http://127.0.0.1:9911/v1`.

| Env var | Purpose |
| --- | --- |
| `WINDSWORD_HOST` / `WINDSWORD_PORT` | Bind address (default `127.0.0.1:8787`) |
| `WINDSWORD_GATEWAY_TOKEN` | Bearer token (auto-generated when not loopback) |
| `WINDSWORD_VAULT_KEY` | 32-byte base64 key for the credential vault (else a 0600 key file in the state dir) |
| `WINDSWORD_STATE_DIR` | Vault, connections, `audit.jsonl` (default `.windsword/`, git-ignored) |
| `WINDSWORD_ALLOWED_ORIGINS` | CORS allow-list (default: localhost 3000/8787). Add the Pages origin to use the hosted UI against your gateway |
| `WINDSWORD_APPROVED_FOR_PROTECTED` | Comma list of cloud providers explicitly approved for protected material (default: none) |
| `WINDSWORD_STATIC_DIR` | UI export to serve (default `out`) |

## Policy (single gate, unit-tested)

Every call (chat, each side of compare) runs `decide()` first. Default posture is **no egress**.

| Rule | Result |
| --- | --- |
| Unknown / disabled provider | blocked |
| Local provider (Ollama, mock) | allowed in every mode |
| Cloud provider in **Secure Local** | blocked, even if connected |
| Cloud provider not connected | blocked |
| Cloud provider + `protected` content **or any attachment** | blocked unless the provider is in the explicit approval list (empty by default) |

Blocked calls make **no vendor request** (asserted in tests). The UI preflights the same rules and disables options with the reason.

## Connection modes — what is real today

| Provider | API key / developer account | Subscription-linked | Notes |
| --- | --- | --- | --- |
| Claude | **Implemented** | **Planned** (Claude Agent SDK). Not enabled until a documented flow is verified; the descriptor keeps it as a capability, because Anthropic has changed this policy before | Console/API billing is separate from a Claude plan |
| OpenAI / ChatGPT | **Implemented** | Not offered by vendor (Sign in with ChatGPT is identity only) | Future: WindSwordAI as a ChatGPT plugin/app |
| Meta Muse | **Implemented** via the OpenAI-compatible route; user supplies the Model API base URL | — | No base URL is hard-coded because none was verified |
| Google Gemini | **Implemented** (free tier or paid key) | — | Consumer Gemini subscriptions do not cover API usage |
| Mistral | **Implemented** | — | Le Chat is separate |
| Ollama | **Implemented** (no account) | — | Models auto-discovered |

No cookie or session scraping exists anywhere. Connecting validates the credential by listing live models (capability detection), so model lists are never stale hard-coded names.

## Compare (side-by-side)

Two independent `/v1/chat` streams share a `compareGroupId`. Each has its own policy decision, audit trail, Stop and Retry. Any two registered providers work; nothing is tied to Claude or OpenAI. With a document attached, cloud sides are blocked independently and the picker falls back to local providers, so a document is never silently duplicated to two clouds.

## Adding a provider

1. `descriptor` (id, name, kind, auth methods with honest status, egress metadata, capabilities).
2. `adapter` with `listModels()` and a streaming `stream()` (or reuse `openai-compat`).
3. `registry.register(adapter)` in `providers/index.ts`.
4. Nothing else: Settings, the picker, policy, compare and audit pick it up from the registry.

## Security notes

- Keys: sent once to the gateway, verified, stored AES-256-GCM encrypted (`vault.json`, 0600), referenced by opaque id. The browser stores only the gateway URL/token, mode and model choice. API responses never contain keys or secret refs. Error text is redacted of the key value.
- Audit (`audit.jsonl`): event type, provider, model, mode, decision, counts (messages/chars/attachments), usage, error code. Built from a fixed field list, so prompt text and credentials cannot be logged. Tests assert this.
- The gateway rejects oversized bodies (1 MB), requires a token beyond loopback, and only sends CORS headers for allow-listed origins.
- `contentClass` is declared by the client for now. PR 04's loader will classify real documents server-side; until then attachments always count as protected.

## Known limitations

- Vendor calls are unit-tested against recorded response formats and end-to-end against fake vendor servers. They have **not** been run against live vendor APIs in CI (no keys). First real key use is the acceptance check.
- The hosted HTTPS site cannot reach a plain-HTTP gateway from Safari (mixed content); use `start:local` (UI served by the gateway) for phones on the same network.
- Subscription-linked Claude, OpenAI plugin/app, OAuth and workspace connectors are designed (auth method descriptors exist) but not implemented.
- Streaming history is client-held; server-side sessions/persistence arrive with Matters (PR 06).

## Review artifacts

- Tests: `npm test` (policy table, adapters, gateway, vault, HTTP). Policy output: `review/provider-policy-tests.txt` (CI artifact).
- End-to-end: `npm run review:gateway` → `review/gateway-e2e.json`, screenshots `review/screenshots/gateway-*.png`, `review/sample-audit-event.json`.
- Responsive: `npm run review:responsive`.
