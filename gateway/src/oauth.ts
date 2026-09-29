// Node-only. Generic OAuth 2.0 Authorization Code + PKCE (S256) connector.
// Provider-agnostic: a provider is enabled by configuration (client id + endpoints + scopes), never by code.
// Tokens are handled server-side only; the browser only ever sees the authorize URL and a redirect back.
import { createHash, randomBytes } from "node:crypto";
import { ProviderError } from "./types.ts";

export interface OAuthClientConfig {
  clientId: string;
  clientSecret?: string;
  scopes: string[];
  authorizeUrl: string;
  tokenUrl: string;
  revokeUrl?: string;
  /** API base URL the adapter should call once connected (optional; adapter default otherwise). */
  baseUrl?: string;
  extraAuthParams?: Record<string, string>;
}

export interface StoredTokens {
  accessToken: string;
  refreshToken?: string;
  /** epoch ms */
  expiresAt?: number;
  scope?: string;
}

interface Pending {
  providerId: string;
  verifier: string;
  returnTo: string;
  redirectUri: string;
  createdAt: number;
}

const PENDING_TTL_MS = 10 * 60_000;

const b64url = (buf: Buffer) => buf.toString("base64url");

/** Only same-site relative paths are allowed as a post-authorization destination (no open redirects). */
export function sanitizeReturnTo(value: unknown, fallback = "/settings/"): string {
  if (typeof value !== "string" || value.length > 300) return fallback;
  if (!value.startsWith("/") || value.startsWith("//") || value.includes("\\") || /[\u0000-\u001f]/.test(value)) return fallback;
  return value;
}

export class OAuthManager {
  private configs: Record<string, OAuthClientConfig>;
  private fetchImpl: typeof fetch;
  private now: () => number;
  private pending = new Map<string, Pending>();

  constructor(opts: { configs: Record<string, OAuthClientConfig>; fetch?: typeof fetch; now?: () => number }) {
    this.configs = opts.configs;
    this.fetchImpl = opts.fetch ?? fetch.bind(globalThis);
    this.now = opts.now ?? Date.now;
  }

  isConfigured(providerId: string) {
    return Boolean(this.configs[providerId]);
  }

  config(providerId: string) {
    return this.configs[providerId];
  }

  private sweep() {
    for (const [state, p] of this.pending) if (this.now() - p.createdAt > PENDING_TTL_MS) this.pending.delete(state);
  }

  /** Build the provider authorization URL. Stores a single-use, provider-bound state + PKCE verifier. */
  start(providerId: string, opts: { returnTo?: string; redirectBase: string }): string {
    const cfg = this.configs[providerId];
    if (!cfg) throw new ProviderError("bad_request", "Account linking is not enabled for that provider.");
    this.sweep();
    const state = b64url(randomBytes(24));
    const verifier = b64url(randomBytes(48));
    const challenge = b64url(createHash("sha256").update(verifier).digest());
    const redirectUri = `${opts.redirectBase.replace(/\/+$/, "")}/oauth/callback/${providerId}`;
    this.pending.set(state, { providerId, verifier, returnTo: sanitizeReturnTo(opts.returnTo), redirectUri, createdAt: this.now() });

    const url = new URL(cfg.authorizeUrl);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("client_id", cfg.clientId);
    url.searchParams.set("redirect_uri", redirectUri);
    if (cfg.scopes.length) url.searchParams.set("scope", cfg.scopes.join(" "));
    url.searchParams.set("state", state);
    url.searchParams.set("code_challenge", challenge);
    url.searchParams.set("code_challenge_method", "S256");
    for (const [k, v] of Object.entries(cfg.extraAuthParams ?? {})) url.searchParams.set(k, v);
    return url.toString();
  }

  private async tokenRequest(cfg: OAuthClientConfig, body: Record<string, string>): Promise<StoredTokens> {
    const form = new URLSearchParams({ client_id: cfg.clientId, ...body });
    if (cfg.clientSecret) form.set("client_secret", cfg.clientSecret);
    let res: Response;
    try {
      res = await this.fetchImpl(cfg.tokenUrl, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
        body: form,
        signal: AbortSignal.timeout(20_000),
      });
    } catch {
      throw new ProviderError("network", "Could not reach the provider to finish linking your account.", true);
    }
    if (!res.ok) throw new ProviderError("auth_failed", "The provider did not accept the authorization. Please try connecting again.", false);
    const json = (await res.json().catch(() => ({}))) as { access_token?: string; refresh_token?: string; expires_in?: number; scope?: string };
    if (!json.access_token) throw new ProviderError("auth_failed", "The provider did not return an access token.", false);
    return {
      accessToken: json.access_token,
      refreshToken: json.refresh_token,
      expiresAt: json.expires_in ? this.now() + json.expires_in * 1000 : undefined,
      scope: json.scope,
    };
  }

  /** Validate state (single use, provider-bound, unexpired) and exchange the code with the PKCE verifier. */
  async complete(providerId: string, params: { code?: string | null; state?: string | null; error?: string | null }): Promise<{ returnTo: string; tokens: StoredTokens; baseUrl?: string }> {
    const state = params.state ?? "";
    const pending = this.pending.get(state);
    this.pending.delete(state); // single use, even on failure
    if (!pending || pending.providerId !== providerId || this.now() - pending.createdAt > PENDING_TTL_MS) {
      throw new ProviderError("bad_request", "That authorization link is invalid or has expired. Please start again.");
    }
    if (params.error || !params.code) {
      throw Object.assign(new ProviderError("auth_failed", "Authorization was cancelled or denied."), { returnTo: pending.returnTo });
    }
    const cfg = this.configs[providerId];
    try {
      const tokens = await this.tokenRequest(cfg, { grant_type: "authorization_code", code: params.code, redirect_uri: pending.redirectUri, code_verifier: pending.verifier });
      return { returnTo: pending.returnTo, tokens, baseUrl: cfg.baseUrl };
    } catch (err) {
      throw Object.assign(err instanceof ProviderError ? err : new ProviderError("internal", "Could not complete linking."), { returnTo: pending.returnTo });
    }
  }

  /** Refresh an access token. Keeps the old refresh token if the provider does not rotate it. */
  async refresh(providerId: string, tokens: StoredTokens): Promise<StoredTokens> {
    const cfg = this.configs[providerId];
    if (!cfg || !tokens.refreshToken) throw new ProviderError("auth_failed", "The connection expired. Please reconnect.", false);
    const next = await this.tokenRequest(cfg, { grant_type: "refresh_token", refresh_token: tokens.refreshToken });
    return { ...next, refreshToken: next.refreshToken ?? tokens.refreshToken, scope: next.scope ?? tokens.scope };
  }

  /** Best-effort revocation on disconnect. Never throws. */
  async revoke(providerId: string, tokens: StoredTokens): Promise<boolean> {
    const cfg = this.configs[providerId];
    if (!cfg?.revokeUrl) return false;
    try {
      const form = new URLSearchParams({ token: tokens.refreshToken ?? tokens.accessToken, client_id: cfg.clientId });
      if (cfg.clientSecret) form.set("client_secret", cfg.clientSecret);
      const res = await this.fetchImpl(cfg.revokeUrl, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: form, signal: AbortSignal.timeout(10_000) });
      return res.ok;
    } catch {
      return false;
    }
  }
}

const GOOGLE = {
  authorizeUrl: "https://accounts.google.com/o/oauth2/v2/auth",
  tokenUrl: "https://oauth2.googleapis.com/token",
  revokeUrl: "https://oauth2.googleapis.com/revoke",
  extraAuthParams: { access_type: "offline", prompt: "consent" },
};

/**
 * Read per-provider OAuth configuration from the environment:
 *   WINDSWORD_OAUTH_<ID>_CLIENT_ID, _CLIENT_SECRET, _SCOPES (space/comma separated),
 *   _AUTHORIZE_URL, _TOKEN_URL, _REVOKE_URL, _BASE_URL, _EXTRA_PARAMS (JSON).
 * A provider is enabled only when a client id, scopes and both endpoints are known. Gemini defaults to
 * Google's endpoints; scopes are never guessed. No other vendor endpoints are assumed.
 */
export function oauthConfigsFromEnv(env: Record<string, string | undefined>, providerIds: string[]): Record<string, OAuthClientConfig> {
  const out: Record<string, OAuthClientConfig> = {};
  for (const id of providerIds) {
    const p = `WINDSWORD_OAUTH_${id.toUpperCase().replace(/[^A-Z0-9]/g, "_")}_`;
    const clientId = env[`${p}CLIENT_ID`];
    if (!clientId) continue;
    const defaults = id === "gemini" ? GOOGLE : undefined;
    const authorizeUrl = env[`${p}AUTHORIZE_URL`] ?? defaults?.authorizeUrl;
    const tokenUrl = env[`${p}TOKEN_URL`] ?? defaults?.tokenUrl;
    const scopes = (env[`${p}SCOPES`] ?? "").split(/[\s,]+/).filter(Boolean);
    if (!authorizeUrl || !tokenUrl || scopes.length === 0) continue;
    let extra: Record<string, string> | undefined = defaults?.extraAuthParams;
    try { if (env[`${p}EXTRA_PARAMS`]) extra = { ...extra, ...JSON.parse(env[`${p}EXTRA_PARAMS`]!) }; } catch { /* ignore malformed */ }
    out[id] = {
      clientId,
      clientSecret: env[`${p}CLIENT_SECRET`],
      scopes,
      authorizeUrl,
      tokenUrl,
      revokeUrl: env[`${p}REVOKE_URL`] ?? defaults?.revokeUrl,
      baseUrl: env[`${p}BASE_URL`],
      extraAuthParams: extra,
    };
  }
  return out;
}
