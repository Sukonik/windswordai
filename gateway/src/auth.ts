// Node-only. WindSwordAI sign-in ("Continue with Google") and server-side sessions.
//
// Identity only: scopes are exactly `openid email profile`. Google Drive and Gemini are separate
// connections with their own clients, scopes and consent (see docs/PR03C_HOSTED_AUTH.md).
//
// Flow: Authorization Code + PKCE (S256) + nonce, code exchanged server-side with the client secret,
// ID token verified (RS256 against Google's JWKS, iss/aud/exp/nonce/email_verified), opaque session
// stored server-side (only a hash of the session id is persisted), HttpOnly cookie.
import { createHash, createPublicKey, createVerify, randomBytes, timingSafeEqual } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { AuditLog } from "./audit.ts";
import { sanitizeReturnTo } from "./oauth.ts";

export const LOGIN_SCOPES = ["openid", "email", "profile"] as const;

export interface GoogleLoginConfig {
  clientId: string;
  clientSecret: string;
  authorizeUrl: string;
  tokenUrl: string;
  jwksUrl: string;
  issuers: string[];
}

export const GOOGLE_DEFAULTS = {
  authorizeUrl: "https://accounts.google.com/o/oauth2/v2/auth",
  tokenUrl: "https://oauth2.googleapis.com/token",
  jwksUrl: "https://www.googleapis.com/oauth2/v3/certs",
  issuers: ["https://accounts.google.com", "accounts.google.com"],
};

/** WINDSWORD_GOOGLE_CLIENT_ID / WINDSWORD_GOOGLE_CLIENT_SECRET (+ test-only endpoint overrides). */
export function googleLoginFromEnv(env: Record<string, string | undefined>): GoogleLoginConfig | undefined {
  const clientId = env.WINDSWORD_GOOGLE_CLIENT_ID?.trim();
  const clientSecret = env.WINDSWORD_GOOGLE_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) return undefined;
  return {
    clientId,
    clientSecret,
    authorizeUrl: env.WINDSWORD_GOOGLE_AUTHORIZE_URL ?? GOOGLE_DEFAULTS.authorizeUrl,
    tokenUrl: env.WINDSWORD_GOOGLE_TOKEN_URL ?? GOOGLE_DEFAULTS.tokenUrl,
    jwksUrl: env.WINDSWORD_GOOGLE_JWKS_URL ?? GOOGLE_DEFAULTS.jwksUrl,
    issuers: env.WINDSWORD_GOOGLE_ISSUER ? [env.WINDSWORD_GOOGLE_ISSUER] : GOOGLE_DEFAULTS.issuers,
  };
}

export type LoginErrorCode = "denied" | "expired" | "not_allowed" | "unverified" | "failed";

export class LoginError extends Error {
  code: LoginErrorCode;
  returnTo?: string;
  constructor(code: LoginErrorCode, message: string, returnTo?: string) {
    super(message);
    this.name = "LoginError";
    this.code = code;
    this.returnTo = returnTo;
  }
}

// ---------------------------------------------------------------------------------------------
// ID token verification
// ---------------------------------------------------------------------------------------------

interface Jwk { kty: string; kid?: string; n?: string; e?: string; use?: string; alg?: string }

export class JwksCache {
  private keys: Jwk[] = [];
  private fetchedAt = 0;
  private url: string;
  private fetchImpl: typeof fetch;
  private now: () => number;
  constructor(url: string, fetchImpl: typeof fetch, now: () => number) {
    this.url = url;
    this.fetchImpl = fetchImpl;
    this.now = now;
  }

  private async refresh() {
    const res = await this.fetchImpl(this.url, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) throw new LoginError("failed", "Could not load the identity provider's signing keys.");
    const json = (await res.json()) as { keys?: Jwk[] };
    this.keys = json.keys ?? [];
    this.fetchedAt = this.now();
  }

  /** Cached for 1h; an unknown key id triggers at most one refetch per minute (key rotation). */
  async get(kid: string): Promise<Jwk | undefined> {
    const stale = this.now() - this.fetchedAt > 3_600_000;
    if (stale || this.keys.length === 0) await this.refresh();
    let key = this.keys.find((k) => k.kid === kid);
    if (!key && this.now() - this.fetchedAt > 60_000) {
      await this.refresh();
      key = this.keys.find((k) => k.kid === kid);
    }
    return key && key.kty === "RSA" ? key : undefined;
  }
}

export interface VerifiedIdentity {
  sub: string;
  email: string;
  name?: string;
  picture?: string;
}

const decode = (part: string) => Buffer.from(part, "base64url");

export async function verifyIdToken(
  idToken: string,
  opts: { clientId: string; issuers: string[]; nonce: string; jwks: JwksCache; now: () => number },
): Promise<VerifiedIdentity> {
  const bad = () => new LoginError("failed", "The sign-in response could not be verified.");
  const parts = idToken.split(".");
  if (parts.length !== 3) throw bad();
  let header: { alg?: string; kid?: string };
  let payload: Record<string, unknown>;
  try {
    header = JSON.parse(decode(parts[0]).toString("utf8"));
    payload = JSON.parse(decode(parts[1]).toString("utf8"));
  } catch {
    throw bad();
  }
  // Only RS256 is accepted: never `none`, never an HMAC keyed with a public value.
  if (header.alg !== "RS256" || !header.kid) throw bad();
  const jwk = await opts.jwks.get(header.kid);
  if (!jwk) throw bad();
  const verifier = createVerify("RSA-SHA256");
  verifier.update(`${parts[0]}.${parts[1]}`);
  let valid = false;
  try {
    valid = verifier.verify(createPublicKey({ key: jwk as unknown as import("node:crypto").JsonWebKey, format: "jwk" }), decode(parts[2]));
  } catch {
    valid = false;
  }
  if (!valid) throw bad();

  const nowSec = Math.floor(opts.now() / 1000);
  const aud = payload.aud;
  const audOk = aud === opts.clientId || (Array.isArray(aud) && aud.includes(opts.clientId) && payload.azp === opts.clientId);
  if (!audOk) throw bad();
  if (typeof payload.iss !== "string" || !opts.issuers.includes(payload.iss)) throw bad();
  if (typeof payload.exp !== "number" || payload.exp < nowSec - 60) throw bad();
  if (typeof payload.iat === "number" && payload.iat > nowSec + 300) throw bad();
  if (payload.nonce !== opts.nonce) throw bad();
  if (typeof payload.sub !== "string" || !payload.sub) throw bad();
  if (typeof payload.email !== "string" || !payload.email) throw bad();
  if (payload.email_verified !== true) throw new LoginError("unverified", "Your Google email address is not verified.");
  return {
    sub: payload.sub,
    email: payload.email.toLowerCase(),
    name: typeof payload.name === "string" ? payload.name : undefined,
    picture: typeof payload.picture === "string" ? payload.picture : undefined,
  };
}

// ---------------------------------------------------------------------------------------------
// Users and sessions
// ---------------------------------------------------------------------------------------------

export interface User {
  id: string;
  sub: string;
  email: string;
  name?: string;
  createdAt: string;
  lastLoginAt: string;
}

export interface Session {
  userId: string;
  csrf: string;
  createdAt: number;
  expiresAt: number;
}

export interface UserStore {
  upsertFromIdentity(identity: VerifiedIdentity): Promise<User>;
  get(id: string): Promise<User | undefined>;
}

/** Sessions are keyed by sha256(sessionId): a leaked sessions file cannot be replayed as cookies. */
export interface SessionStore {
  put(sessionHash: string, session: Session): Promise<void>;
  get(sessionHash: string): Promise<Session | undefined>;
  delete(sessionHash: string): Promise<void>;
}

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

export class MemoryUserStore implements UserStore {
  private byId = new Map<string, User>();
  async upsertFromIdentity(identity: VerifiedIdentity) {
    const now = new Date().toISOString();
    const existing = [...this.byId.values()].find((u) => u.sub === identity.sub);
    const user: User = existing
      ? { ...existing, email: identity.email, name: identity.name, lastLoginAt: now }
      : { id: `usr_${randomBytes(9).toString("hex")}`, sub: identity.sub, email: identity.email, name: identity.name, createdAt: now, lastLoginAt: now };
    this.byId.set(user.id, user);
    return user;
  }
  async get(id: string) {
    return this.byId.get(id);
  }
}

export class MemorySessionStore implements SessionStore {
  private map = new Map<string, Session>();
  async put(hash: string, session: Session) {
    this.map.set(hash, session);
  }
  async get(hash: string) {
    return this.map.get(hash);
  }
  async delete(hash: string) {
    this.map.delete(hash);
  }
}

function readJson<T>(path: string, fallback: T): T {
  return existsSync(path) ? (JSON.parse(readFileSync(path, "utf8")) as T) : fallback;
}

export class FileUserStore implements UserStore {
  private path: string;
  constructor(dir: string) {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    this.path = join(dir, "users.json");
  }
  async upsertFromIdentity(identity: VerifiedIdentity) {
    const all = readJson<Record<string, User>>(this.path, {});
    const now = new Date().toISOString();
    const existing = Object.values(all).find((u) => u.sub === identity.sub);
    const user: User = existing
      ? { ...existing, email: identity.email, name: identity.name, lastLoginAt: now }
      : { id: `usr_${randomBytes(9).toString("hex")}`, sub: identity.sub, email: identity.email, name: identity.name, createdAt: now, lastLoginAt: now };
    all[user.id] = user;
    writeFileSync(this.path, JSON.stringify(all, null, 2), { mode: 0o600 });
    return user;
  }
  async get(id: string) {
    return readJson<Record<string, User>>(this.path, {})[id];
  }
}

export class FileSessionStore implements SessionStore {
  private path: string;
  constructor(dir: string) {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    this.path = join(dir, "sessions.json");
  }
  private read() {
    return readJson<Record<string, Session>>(this.path, {});
  }
  private write(all: Record<string, Session>) {
    writeFileSync(this.path, JSON.stringify(all), { mode: 0o600 });
  }
  async put(hash: string, session: Session) {
    const all = this.read();
    const now = Date.now();
    for (const [k, v] of Object.entries(all)) if (v.expiresAt < now) delete all[k]; // opportunistic cleanup
    all[hash] = session;
    this.write(all);
  }
  async get(hash: string) {
    return this.read()[hash];
  }
  async delete(hash: string) {
    const all = this.read();
    delete all[hash];
    this.write(all);
  }
}

// ---------------------------------------------------------------------------------------------
// Cookies
// ---------------------------------------------------------------------------------------------

export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of (header ?? "").split(";")) {
    const i = part.indexOf("=");
    if (i < 1) continue;
    const name = part.slice(0, i).trim();
    const value = part.slice(i + 1).trim();
    if (!(name in out)) out[name] = value; // first wins
  }
  return out;
}

export function buildCookie(name: string, value: string, opts: { maxAge: number; secure: boolean; path?: string }): string {
  return [`${name}=${value}`, `Path=${opts.path ?? "/"}`, `Max-Age=${opts.maxAge}`, "HttpOnly", "SameSite=Lax", ...(opts.secure ? ["Secure"] : [])].join("; ");
}

// ---------------------------------------------------------------------------------------------
// Auth service
// ---------------------------------------------------------------------------------------------

export type AuthMode = "off" | "required";

export interface AuthOptions {
  mode: AuthMode;
  google?: GoogleLoginConfig;
  users?: UserStore;
  sessions?: SessionStore;
  fetch?: typeof fetch;
  now?: () => number;
  /** Comma-list entries: full emails, or `@domain.com`. Empty = anyone with a verified Google account. */
  allowedEmails?: string[];
  sessionTtlMs?: number;
  /** True when the public origin is https: cookies are Secure and use the __Host- prefix. */
  secureCookies?: boolean;
  /** Optional audit log: records login/logout by opaque user id only (never emails or tokens). */
  audit?: AuditLog;
}

interface PendingLogin {
  verifier: string;
  nonce: string;
  returnTo: string;
  redirectUri: string;
  createdAt: number;
}

const PENDING_TTL_MS = 10 * 60_000;

export class AuthService {
  readonly mode: AuthMode;
  readonly secure: boolean;
  readonly sessionCookie: string;
  readonly loginCookie = "ws_login";
  readonly allowed: string[];
  private google?: GoogleLoginConfig;
  private users: UserStore;
  private sessions: SessionStore;
  private fetchImpl: typeof fetch;
  private now: () => number;
  private ttl: number;
  private jwks?: JwksCache;
  private pending = new Map<string, PendingLogin>();
  private audit?: AuditLog;

  constructor(opts: AuthOptions) {
    this.audit = opts.audit;
    this.mode = opts.mode;
    this.google = opts.google;
    this.users = opts.users ?? new MemoryUserStore();
    this.sessions = opts.sessions ?? new MemorySessionStore();
    this.fetchImpl = opts.fetch ?? fetch.bind(globalThis);
    this.now = opts.now ?? Date.now;
    this.ttl = opts.sessionTtlMs ?? 7 * 24 * 3_600_000;
    this.secure = Boolean(opts.secureCookies);
    this.sessionCookie = this.secure ? "__Host-windsword_session" : "windsword_session";
    this.allowed = (opts.allowedEmails ?? []).map((e) => e.trim().toLowerCase()).filter(Boolean);
    if (this.google) this.jwks = new JwksCache(this.google.jwksUrl, this.fetchImpl, this.now);
  }

  get googleConfigured() {
    return Boolean(this.google);
  }

  get maxAgeSeconds() {
    return Math.floor(this.ttl / 1000);
  }

  isAllowed(email: string) {
    if (this.allowed.length === 0) return true;
    const e = email.toLowerCase();
    return this.allowed.some((rule) => (rule.startsWith("@") ? e.endsWith(rule) : e === rule));
  }

  /** Begin sign-in. Returns the Google URL and the value for the short-lived login-binding cookie. */
  startLogin(opts: { returnTo?: string; redirectBase: string }): { url: string; state: string } {
    if (!this.google) throw new LoginError("failed", "Google sign-in is not configured.");
    for (const [s, p] of this.pending) if (this.now() - p.createdAt > PENDING_TTL_MS) this.pending.delete(s);
    const state = randomBytes(24).toString("base64url");
    const verifier = randomBytes(48).toString("base64url");
    const nonce = randomBytes(16).toString("base64url");
    const redirectUri = `${opts.redirectBase.replace(/\/+$/, "")}/oauth/callback/google`;
    this.pending.set(state, { verifier, nonce, returnTo: sanitizeReturnTo(opts.returnTo, "/chat/"), redirectUri, createdAt: this.now() });
    const url = new URL(this.google.authorizeUrl);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("client_id", this.google.clientId);
    url.searchParams.set("redirect_uri", redirectUri);
    url.searchParams.set("scope", LOGIN_SCOPES.join(" "));
    url.searchParams.set("state", state);
    url.searchParams.set("nonce", nonce);
    url.searchParams.set("code_challenge", createHash("sha256").update(verifier).digest("base64url"));
    url.searchParams.set("code_challenge_method", "S256");
    url.searchParams.set("prompt", "select_account");
    return { url: url.toString(), state };
  }

  /**
   * Finish sign-in. `cookieState` is the value of the login-binding cookie set at start: without it
   * an attacker could get a victim signed in as the attacker (login CSRF).
   */
  async completeLogin(params: { code?: string | null; state?: string | null; error?: string | null; cookieState?: string }): Promise<{ sessionId: string; user: User; returnTo: string }> {
    try {
      const done = await this.completeLoginInner(params);
      this.audit?.record({ type: "auth.login", userId: done.user.id });
      return done;
    } catch (err) {
      this.audit?.record({ type: "auth.login_failed", errorCode: err instanceof LoginError ? err.code : "failed" });
      throw err;
    }
  }

  private async completeLoginInner(params: { code?: string | null; state?: string | null; error?: string | null; cookieState?: string }): Promise<{ sessionId: string; user: User; returnTo: string }> {
    if (!this.google || !this.jwks) throw new LoginError("failed", "Google sign-in is not configured.");
    const state = params.state ?? "";
    const pending = this.pending.get(state);
    this.pending.delete(state); // single use even on failure
    const expired = !pending || this.now() - pending.createdAt > PENDING_TTL_MS;
    const bound = Boolean(params.cookieState) && params.cookieState!.length === state.length && timingSafeEqual(Buffer.from(params.cookieState!), Buffer.from(state));
    if (expired || !bound) throw new LoginError("expired", "That sign-in link is invalid or has expired. Please try again.");
    if (params.error || !params.code) throw new LoginError("denied", "Sign-in was cancelled.", pending.returnTo);

    let idToken: string | undefined;
    try {
      const res = await this.fetchImpl(this.google.tokenUrl, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
        body: new URLSearchParams({
          grant_type: "authorization_code",
          code: params.code,
          redirect_uri: pending.redirectUri,
          client_id: this.google.clientId,
          client_secret: this.google.clientSecret,
          code_verifier: pending.verifier,
        }),
        signal: AbortSignal.timeout(15_000),
      });
      if (!res.ok) throw new LoginError("failed", "Google did not accept the sign-in.", pending.returnTo);
      idToken = ((await res.json()) as { id_token?: string }).id_token;
    } catch (err) {
      if (err instanceof LoginError) throw err;
      throw new LoginError("failed", "Could not reach Google to finish signing in.", pending.returnTo);
    }
    if (!idToken) throw new LoginError("failed", "Google did not return an identity.", pending.returnTo);

    let identity: VerifiedIdentity;
    try {
      identity = await verifyIdToken(idToken, { clientId: this.google.clientId, issuers: this.google.issuers, nonce: pending.nonce, jwks: this.jwks, now: this.now });
    } catch (err) {
      throw err instanceof LoginError ? new LoginError(err.code, err.message, pending.returnTo) : new LoginError("failed", "Sign-in failed.", pending.returnTo);
    }
    if (!this.isAllowed(identity.email)) throw new LoginError("not_allowed", "This account is not on the access list.", pending.returnTo);

    const user = await this.users.upsertFromIdentity(identity);
    const sessionId = randomBytes(32).toString("base64url");
    await this.sessions.put(sha256(sessionId), { userId: user.id, csrf: randomBytes(24).toString("base64url"), createdAt: this.now(), expiresAt: this.now() + this.ttl });
    return { sessionId, user, returnTo: pending.returnTo };
  }

  /** Resolve a session cookie value to a user + CSRF token. Expired sessions are removed. */
  async authenticate(cookieHeader: string | undefined): Promise<{ user: User; csrf: string; sessionId: string } | undefined> {
    const sessionId = parseCookies(cookieHeader)[this.sessionCookie];
    if (!sessionId || sessionId.length < 20) return undefined;
    const hash = sha256(sessionId);
    const session = await this.sessions.get(hash);
    if (!session) return undefined;
    if (session.expiresAt < this.now()) {
      await this.sessions.delete(hash);
      return undefined;
    }
    const user = await this.users.get(session.userId);
    return user ? { user, csrf: session.csrf, sessionId } : undefined;
  }

  async logout(sessionId: string) {
    const hash = sha256(sessionId);
    const session = await this.sessions.get(hash);
    await this.sessions.delete(hash);
    if (session) this.audit?.record({ type: "auth.logout", userId: session.userId });
  }
}
