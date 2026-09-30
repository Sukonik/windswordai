import test from "node:test";
import assert from "node:assert/strict";
import { createHash, createHmac, generateKeyPairSync, createSign } from "node:crypto";
import { AuthService, JwksCache, LOGIN_SCOPES, MemorySessionStore, MemoryUserStore, googleLoginFromEnv, parseCookies, verifyIdToken } from "../gateway/src/auth.ts";
import { AuditLog } from "../gateway/src/audit.ts";
import { Gateway } from "../gateway/src/gateway.ts";
import { createHttpServer } from "../gateway/src/http.ts";
import { OAuthManager } from "../gateway/src/oauth.ts";
import { createDefaultRegistry } from "../gateway/src/providers/index.ts";
import { MemoryConnectionStore, MemorySecretStore } from "../gateway/src/stores.ts";
import { fakeFetch, jsonResponse, sseResponse } from "./helpers.mjs";

const CLIENT_ID = "test-client.apps.googleusercontent.com";
const CLIENT_SECRET = "fake-google-client-secret-for-tests-only";
const AUTHORIZE = "https://google.test/authorize";
const TOKEN = "https://google.test/token";
const JWKS = "https://google.test/certs";
const ISSUER = "https://accounts.google.com";
const CLAUDE_KEY = "sk-claude-user-secret-123456";

const b64 = (o) => Buffer.from(typeof o === "string" ? o : JSON.stringify(o)).toString("base64url");

/** A fake Google: signing keys, JWKS, and a token endpoint that verifies PKCE like the real one. */
function makeGoogle() {
  const kp = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const other = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const jwk = { ...kp.publicKey.export({ format: "jwk" }), kid: "key-1", alg: "RS256", use: "sig" };
  const state = { codes: new Map(), jwksCalls: 0, tokenCalls: [], keys: [jwk] };

  function sign(payload, { key = kp.privateKey, header = { alg: "RS256", kid: "key-1", typ: "JWT" } } = {}) {
    const signingInput = `${b64(header)}.${b64(payload)}`;
    const sig = createSign("RSA-SHA256").update(signingInput).sign(key).toString("base64url");
    return `${signingInput}.${sig}`;
  }
  const baseClaims = (identity, nonce, now) => ({
    iss: ISSUER, aud: CLIENT_ID, azp: CLIENT_ID, sub: identity.sub, email: identity.email, email_verified: identity.email_verified ?? true,
    name: identity.name, picture: identity.picture, nonce, iat: Math.floor(now / 1000), exp: Math.floor(now / 1000) + 3600,
  });

  /** Play the browser+IdP: visit the authorize URL as `identity`; returns the params Google would redirect back with. */
  function authorize(url, identity, { tamper } = {}) {
    const q = new URL(url).searchParams;
    const code = `code-${state.codes.size + 1}`;
    state.codes.set(code, { challenge: q.get("code_challenge"), nonce: q.get("nonce"), redirectUri: q.get("redirect_uri"), identity, tamper });
    return { code, state: q.get("state"), q };
  }

  const routes = [
    [(u) => u === JWKS, () => { state.jwksCalls++; return jsonResponse({ keys: state.keys }); }],
    [(u) => u === TOKEN, (_u, init) => {
      const f = new URLSearchParams(init.body.toString());
      state.tokenCalls.push(Object.fromEntries(f));
      const entry = state.codes.get(f.get("code"));
      state.codes.delete(f.get("code"));
      const pkceOk = entry && createHash("sha256").update(f.get("code_verifier") ?? "").digest("base64url") === entry.challenge;
      if (!entry || !pkceOk || f.get("client_secret") !== CLIENT_SECRET || f.get("client_id") !== CLIENT_ID || f.get("redirect_uri") !== entry.redirectUri) return jsonResponse({ error: "invalid_grant" }, 400);
      const claims = { ...baseClaims(entry.identity, entry.nonce, Date.now()), ...(entry.tamper?.claims ?? {}) };
      const idToken = entry.tamper?.token ? entry.tamper.token(claims) : sign(claims);
      return jsonResponse({ access_token: "ya29.fake-google-access-token", id_token: idToken, expires_in: 3600 });
    }],
    // Anthropic-shaped upstream for the per-user isolation tests
    [(u) => u.endsWith("/v1/models?limit=100"), (_u, init) => (init.headers["x-api-key"] === CLAUDE_KEY ? jsonResponse({ data: [{ id: "claude-x" }] }) : jsonResponse({}, 401))],
    [(u) => u.endsWith("/v1/messages"), () => sseResponse([{ data: { type: "content_block_delta", delta: { type: "text_delta", text: "hi" } } }, { data: { type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 1 } } }])],
  ];
  return { kp, other, jwk, state, sign, authorize, fetch: fakeFetch(routes), baseClaims };
}

const ALICE = { sub: "sub-alice", email: "alice@example.com", name: "Alice A" };
const BOB = { sub: "sub-bob", email: "bob@corp.example", name: "Bob B" };

const googleConfig = { clientId: CLIENT_ID, clientSecret: CLIENT_SECRET, authorizeUrl: AUTHORIZE, tokenUrl: TOKEN, jwksUrl: JWKS, issuers: [ISSUER, "accounts.google.com"] };

async function makeWorld(opts = {}) {
  const google = makeGoogle();
  const lines = [];
  const audit = new AuditLog((l) => lines.push(l));
  let now = opts.now ?? Date.now();
  const clock = () => now;
  const sessionPuts = [];
  const sessions = new MemorySessionStore();
  const origPut = sessions.put.bind(sessions);
  sessions.put = async (hash, s) => { sessionPuts.push(hash); return origPut(hash, s); };
  const auth = new AuthService({ mode: "required", google: opts.noGoogle ? undefined : googleConfig, users: new MemoryUserStore(), sessions, fetch: google.fetch, now: clock, audit, secureCookies: opts.secure, allowedEmails: opts.allowedEmails, sessionTtlMs: opts.ttl });
  const oauth = new OAuthManager({ configs: { gemini: { clientId: "gem", scopes: ["s"], authorizeUrl: "https://idp.test/a", tokenUrl: "https://idp.test/t" } }, fetch: google.fetch });
  const gateway = new Gateway({ registry: createDefaultRegistry({ mockDelayMs: 0 }), fetch: google.fetch, audit, secrets: new MemorySecretStore(), connections: new MemoryConnectionStore(), oauth });
  const server = createHttpServer({ gateway, auth, publicUrl: opts.publicUrl, token: opts.token, allowedOrigins: opts.allowedOrigins });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${server.address().port}`;
  return { google, audit, lines, auth, gateway, server, base, sessionPuts, advance: (ms) => { now += ms; }, close: () => server.close() };
}

/** Minimal browser: cookie jar + manual redirects. */
function browser(world) {
  const jar = new Map();
  const cookieHeader = () => [...jar].map(([k, v]) => `${k}=${v}`).join("; ");
  const store = (res) => {
    for (const c of res.headers.getSetCookie?.() ?? []) {
      const [pair, ...attrs] = c.split(";").map((x) => x.trim());
      const i = pair.indexOf("=");
      const name = pair.slice(0, i), value = pair.slice(i + 1);
      if (/max-age=0/i.test(attrs.join(";")) || value === "") jar.delete(name); else jar.set(name, value);
    }
  };
  async function fetchWith(path, init = {}) {
    const res = await fetch(path.startsWith("http") ? path : world.base + path, { redirect: "manual", ...init, headers: { ...(init.headers ?? {}), ...(jar.size ? { cookie: cookieHeader() } : {}) } });
    store(res);
    return res;
  }
  /** Full sign-in as `identity`. Returns the final redirect Location. */
  async function signIn(identity, { returnTo = "/chat/", tamper, dropLoginCookie, mutateState } = {}) {
    const start = await fetchWith(`/auth/google/start?returnTo=${encodeURIComponent(returnTo)}`);
    assert.equal(start.status, 302, "start should redirect to Google");
    const google = world.google.authorize(start.headers.get("location"), identity, { tamper });
    if (dropLoginCookie) jar.delete("ws_login");
    const cb = await fetchWith(`/oauth/callback/google?code=${google.code}&state=${mutateState ? mutateState(google.state) : google.state}`);
    return { start, cb, location: cb.headers.get("location"), google };
  }
  async function me() {
    return (await fetchWith("/v1/auth/me")).json();
  }
  return { jar, fetchWith, signIn, me, cookieHeader };
}

// ---------------------------------------------------------------------------------------------

test("sign-in requests exactly openid email profile, with PKCE S256, state and nonce, and never the secret", async () => {
  const w = await makeWorld();
  try {
    assert.deepEqual([...LOGIN_SCOPES], ["openid", "email", "profile"]);
    const b = browser(w);
    const start = await b.fetchWith("/auth/google/start?returnTo=/settings/");
    const url = new URL(start.headers.get("location"));
    const q = url.searchParams;
    assert.equal(url.origin + url.pathname, AUTHORIZE);
    assert.equal(q.get("scope"), "openid email profile");
    assert.equal(q.get("response_type"), "code");
    assert.equal(q.get("client_id"), CLIENT_ID);
    assert.equal(q.get("code_challenge_method"), "S256");
    assert.ok(q.get("state").length >= 24 && q.get("nonce").length >= 16);
    assert.equal(q.get("redirect_uri"), `${w.base}/oauth/callback/google`);
    assert.ok(!url.toString().includes(CLIENT_SECRET));
    const login = start.headers.getSetCookie().find((c) => c.startsWith("ws_login="));
    assert.match(login, /HttpOnly/);
    assert.match(login, /SameSite=Lax/);
    assert.match(login, /Path=\/oauth\/callback\/google/);
    assert.match(login, /Max-Age=600/);
  } finally { w.close(); }
});

test("happy path: signed in with an HttpOnly session cookie; /v1/auth/me exposes only name, email and a CSRF token", async () => {
  const w = await makeWorld();
  try {
    const b = browser(w);
    const { location, google } = await b.signIn(ALICE, { returnTo: "/settings/" });
    assert.equal(location, "/settings/");
    // The code exchange used the secret + verifier server-side.
    const grant = w.google.state.tokenCalls[0];
    assert.equal(grant.client_secret, CLIENT_SECRET);
    assert.ok(grant.code_verifier);
    assert.equal(google.q.get("scope"), "openid email profile");

    const session = [...b.jar.keys()];
    assert.ok(session.includes("windsword_session"));
    const me = await b.me();
    assert.equal(me.authenticated, true);
    assert.deepEqual(me.user, { name: "Alice A", email: "alice@example.com" });
    assert.ok(me.csrfToken.length >= 20);
    const dump = JSON.stringify(me) + w.lines.join("\n") + JSON.stringify(w.audit.recent(100));
    for (const secret of [CLIENT_SECRET, "ya29.fake-google-access-token", "eyJ"]) assert.ok(!dump.includes(secret), `leaked ${secret}`);
    const logsOnly = w.lines.join("\n") + JSON.stringify(w.audit.recent(100));
    assert.ok(!logsOnly.includes("alice@example.com") && !logsOnly.includes("Alice A"), "audit/logs must not contain the email or name");
    assert.ok(w.audit.recent(50).some((e) => e.type === "auth.login" && e.userId?.startsWith("usr_")));
    // Signed-out browsers learn nothing.
    const anon = await (await fetch(`${w.base}/v1/auth/me`)).json();
    assert.deepEqual([anon.authenticated, anon.user, anon.csrfToken, anon.mode, anon.googleConfigured], [false, undefined, undefined, "required", true]);
  } finally { w.close(); }
});

test("session cookie flags: HttpOnly + SameSite=Lax; over https it is Secure with the __Host- prefix and no Domain", async () => {
  const plain = await makeWorld();
  const secure = await makeWorld({ secure: true, publicUrl: "https://app.example.com" });
  try {
    const b1 = browser(plain);
    const start1 = await b1.fetchWith("/auth/google/start");
    const g1 = plain.google.authorize(start1.headers.get("location"), ALICE);
    b1.jar.set("ws_login", g1.state);
    const cb1 = await fetch(`${plain.base}/oauth/callback/google?code=${g1.code}&state=${g1.state}`, { redirect: "manual", headers: { cookie: `ws_login=${g1.state}` } });
    const c1 = cb1.headers.getSetCookie().find((c) => c.startsWith("windsword_session="));
    assert.match(c1, /HttpOnly/); assert.match(c1, /SameSite=Lax/); assert.match(c1, /Path=\//); assert.doesNotMatch(c1, /Secure/); assert.doesNotMatch(c1, /Domain=/);

    // Secure deployment: the start route must run under https to be reachable; call the service directly for cookie shape.
    assert.equal(secure.auth.sessionCookie, "__Host-windsword_session");
    const start2 = secure.auth.startLogin({ redirectBase: "https://app.example.com" });
    const g2 = secure.google.authorize(start2.url, ALICE);
    const cb2 = await fetch(`${secure.base}/oauth/callback/google?code=${g2.code}&state=${g2.state}`, { redirect: "manual", headers: { cookie: `ws_login=${g2.state}` } });
    const c2 = cb2.headers.getSetCookie().find((c) => c.startsWith("__Host-windsword_session="));
    assert.match(c2, /Secure/); assert.match(c2, /HttpOnly/); assert.match(c2, /Path=\//); assert.doesNotMatch(c2, /Domain=/);
    assert.equal(new URL(start2.url).searchParams.get("redirect_uri"), "https://app.example.com/oauth/callback/google");
  } finally { plain.close(); secure.close(); }
});

test("only a hash of the session id is stored server-side", async () => {
  const w = await makeWorld();
  try {
    const b = browser(w);
    await b.signIn(ALICE);
    const raw = b.jar.get("windsword_session");
    assert.ok(raw);
    assert.equal(w.sessionPuts.length, 1);
    assert.notEqual(w.sessionPuts[0], raw);
    assert.equal(w.sessionPuts[0], createHash("sha256").update(raw).digest("hex"));
  } finally { w.close(); }
});

test("login CSRF: no session without the login-binding cookie; replayed or forged state is refused", async () => {
  const w = await makeWorld();
  try {
    const b = browser(w);
    const noCookie = await b.signIn(ALICE, { dropLoginCookie: true });
    assert.match(noCookie.location, /login_error=expired/);
    assert.equal((await b.me()).authenticated, false, "attacker-initiated login must not sign the victim in");

    const ok = await b.signIn(ALICE);
    assert.equal(ok.location, "/chat/");
    // Replay the same state: single use.
    const replay = await fetch(`${w.base}/oauth/callback/google?code=code-x&state=${ok.google.state}`, { redirect: "manual", headers: { cookie: `ws_login=${ok.google.state}` } });
    assert.match(replay.headers.get("location"), /login_error=expired/);

    const victim = browser(w);
    const start = await victim.fetchWith("/auth/google/start");
    const g = w.google.authorize(start.headers.get("location"), ALICE);
    victim.jar.set("ws_login", "some-other-state-value-of-similar-length-xx");
    const forged = await victim.fetchWith(`/oauth/callback/google?code=${g.code}&state=${g.state}`);
    assert.match(forged.headers.get("location"), /login_error=expired/);
    assert.equal((await victim.me()).authenticated, false);
  } finally { w.close(); }
});

test("denied consent and open-redirect attempts end safely", async () => {
  const w = await makeWorld();
  try {
    const b = browser(w);
    const start = await b.fetchWith("/auth/google/start?returnTo=/settings/");
    const g = w.google.authorize(start.headers.get("location"), ALICE);
    const denied = await b.fetchWith(`/oauth/callback/google?error=access_denied&state=${g.state}`);
    assert.equal(denied.headers.get("location"), "/settings/?login_error=denied");
    assert.equal((await b.me()).authenticated, false);

    for (const evil of ["https://evil.example/", "//evil.example", "/\\evil.example"]) {
      const r = await b.signIn(ALICE, { returnTo: evil });
      assert.equal(r.location, "/chat/", `returnTo ${evil} must fall back`);
    }
  } finally { w.close(); }
});

test("ID token verification rejects forged, mis-addressed and stale tokens", async () => {
  const g = makeGoogle();
  const now = Date.now();
  const nonce = "nonce-123";
  const jwks = () => new JwksCache(JWKS, g.fetch, () => Date.now());
  const opts = () => ({ clientId: CLIENT_ID, issuers: [ISSUER], nonce, jwks: jwks(), now: () => Date.now() });
  const claims = g.baseClaims(ALICE, nonce, now);

  const ok = await verifyIdToken(g.sign(claims), opts());
  assert.deepEqual([ok.sub, ok.email, ok.name], ["sub-alice", "alice@example.com", "Alice A"]);

  const cases = {
    "signed with a different RSA key": g.sign(claims, { key: g.other.privateKey }),
    "wrong audience": g.sign({ ...claims, aud: "someone-else" }),
    "audience array without matching azp": g.sign({ ...claims, aud: [CLIENT_ID, "x"], azp: "x" }),
    "wrong issuer": g.sign({ ...claims, iss: "https://evil.example" }),
    "expired": g.sign({ ...claims, exp: Math.floor(now / 1000) - 3600 }),
    "nonce mismatch (replayed token)": g.sign({ ...claims, nonce: "other" }),
    "missing subject": g.sign({ ...claims, sub: undefined }),
    "missing email": g.sign({ ...claims, email: undefined }),
    "issued far in the future": g.sign({ ...claims, iat: Math.floor(now / 1000) + 7200 }),
  };
  for (const [name, token] of Object.entries(cases)) await assert.rejects(() => verifyIdToken(token, opts()), (e) => e.name === "LoginError", name);

  // Algorithm confusion: `none`, and HS256 keyed with the (public) RSA modulus.
  const none = `${b64({ alg: "none", kid: "key-1" })}.${b64(claims)}.`;
  await assert.rejects(() => verifyIdToken(none, opts()), /could not be verified/);
  const hsInput = `${b64({ alg: "HS256", kid: "key-1" })}.${b64(claims)}`;
  const hs = `${hsInput}.${createHmac("sha256", g.jwk.n).update(hsInput).digest("base64url")}`;
  await assert.rejects(() => verifyIdToken(hs, opts()), /could not be verified/);
  await assert.rejects(() => verifyIdToken("not.a.jwt.at.all", opts()), /could not be verified/);
  await assert.rejects(() => verifyIdToken(g.sign({ ...claims, email_verified: false }), opts()), (e) => e.code === "unverified");
});

test("unknown key id triggers one JWKS refetch (rotation) but not a stampede", async () => {
  const g = makeGoogle();
  let t = 1_000_000;
  const cache = new JwksCache(JWKS, g.fetch, () => t);
  const claims = g.baseClaims(ALICE, "n", t);
  const opts = { clientId: CLIENT_ID, issuers: [ISSUER], nonce: "n", jwks: cache, now: () => t };
  await verifyIdToken(g.sign(claims), opts);
  assert.equal(g.state.jwksCalls, 1, "cached");
  await verifyIdToken(g.sign(claims), opts);
  assert.equal(g.state.jwksCalls, 1);

  const rotated = generateKeyPairSync("rsa", { modulusLength: 2048 });
  g.state.keys = [{ ...rotated.publicKey.export({ format: "jwk" }), kid: "key-2", alg: "RS256", use: "sig" }];
  const withNewKey = g.sign(claims, { key: rotated.privateKey, header: { alg: "RS256", kid: "key-2" } });
  // Inside the 60s cooldown a new kid is not fetched again (attackers can't force refetches).
  await assert.rejects(() => verifyIdToken(withNewKey, opts));
  assert.equal(g.state.jwksCalls, 1);
  t += 61_000;
  await verifyIdToken(withNewKey, opts);
  assert.equal(g.state.jwksCalls, 2);
});

test("token-endpoint failures and tampered ID tokens never create a session", async () => {
  const w = await makeWorld();
  try {
    const b = browser(w);
    const forged = await b.signIn(ALICE, { tamper: { token: (claims) => w.google.sign(claims, { key: w.google.other.privateKey }) } });
    assert.match(forged.location, /login_error=failed/);
    const wrongAud = await b.signIn(ALICE, { tamper: { claims: { aud: "another-client" } } });
    assert.match(wrongAud.location, /login_error=failed/);
    const unverified = await b.signIn({ ...ALICE, email_verified: false });
    assert.match(unverified.location, /login_error=unverified/);
    assert.equal((await b.me()).authenticated, false);
    assert.equal(w.audit.recent(50).filter((e) => e.type === "auth.login_failed").length, 3);
  } finally { w.close(); }
});

test("access list: exact emails and @domain rules; everyone else is refused without a session", async () => {
  const w = await makeWorld({ allowedEmails: ["alice@example.com", "@corp.example"] });
  try {
    const stranger = browser(w);
    const r = await stranger.signIn({ sub: "sub-eve", email: "eve@elsewhere.test", name: "Eve" });
    assert.match(r.location, /login_error=not_allowed/);
    assert.equal((await stranger.me()).authenticated, false);
    assert.equal((await browser(w).signIn(ALICE)).location, "/chat/");
    assert.equal((await browser(w).signIn(BOB)).location, "/chat/");
    assert.ok(!w.lines.join("\n").includes("eve@elsewhere.test"), "denied emails are not logged");
  } finally { w.close(); }
});

test("sessions expire, and logout needs the CSRF token then revokes the session", async () => {
  const w = await makeWorld({ ttl: 3_600_000 });
  try {
    const b = browser(w);
    await b.signIn(ALICE);
    const me = await b.me();
    const noCsrf = await b.fetchWith("/v1/auth/logout", { method: "POST" });
    assert.equal(noCsrf.status, 403);
    assert.equal((await noCsrf.json()).error.code, "csrf");
    assert.equal((await b.me()).authenticated, true, "still signed in after a rejected logout");

    const stolenCookie = b.cookieHeader();
    const out = await b.fetchWith("/v1/auth/logout", { method: "POST", headers: { "x-csrf-token": me.csrfToken } });
    assert.equal(out.status, 200);
    assert.equal((await b.me()).authenticated, false);
    const replay = await fetch(`${w.base}/v1/providers?mode=secure_local`, { headers: { cookie: stolenCookie } });
    assert.equal(replay.status, 401, "a copied cookie is dead after logout");
    assert.ok(w.audit.recent(50).some((e) => e.type === "auth.logout"));

    const c = browser(w);
    await c.signIn(ALICE);
    w.advance(3_600_000 + 1000);
    assert.equal((await c.me()).authenticated, false, "expired session");
  } finally { w.close(); }
});

test("sign-in required: the API is closed to anonymous callers, health/me/static stay open", async () => {
  const w = await makeWorld();
  try {
    const anon = { redirect: "manual" };
    const denied = await fetch(`${w.base}/v1/providers?mode=secure_local`, anon);
    assert.equal(denied.status, 401);
    assert.equal((await denied.json()).error.code, "login_required");
    for (const [path, method] of [["/v1/audit", "GET"], ["/v1/chat", "POST"], ["/v1/connections/claude", "POST"], ["/v1/connections/claude", "DELETE"], ["/v1/preflight", "POST"]]) {
      assert.equal((await fetch(w.base + path, { method, body: method === "POST" ? "{}" : undefined, ...anon })).status, 401, `${method} ${path}`);
    }
    const health = await (await fetch(`${w.base}/v1/health`)).json();
    assert.deepEqual(health.auth, { mode: "required", googleConfigured: true });
    assert.equal((await fetch(`${w.base}/v1/auth/me`)).status, 200);

    const b = browser(w);
    await b.signIn(ALICE);
    assert.equal((await b.fetchWith("/v1/providers?mode=secure_local")).status, 200);
  } finally { w.close(); }
});

test("CSRF: state-changing calls with a session need the token and a same-origin Origin", async () => {
  const w = await makeWorld({ allowedOrigins: ["https://trusted.example"] });
  try {
    const b = browser(w);
    await b.signIn(ALICE);
    const { csrfToken } = await b.me();
    const body = JSON.stringify({ type: "api_key", apiKey: CLAUDE_KEY });
    const headers = { "content-type": "application/json" };

    const noToken = await b.fetchWith("/v1/connections/claude", { method: "POST", headers, body });
    assert.equal(noToken.status, 403);
    const wrongToken = await b.fetchWith("/v1/connections/claude", { method: "POST", headers: { ...headers, "x-csrf-token": "nope" }, body });
    assert.equal(wrongToken.status, 403);
    const evilOrigin = await b.fetchWith("/v1/connections/claude", { method: "POST", headers: { ...headers, "x-csrf-token": csrfToken, origin: "https://evil.example" }, body });
    assert.equal(evilOrigin.status, 403);
    assert.equal((await evilOrigin.json()).error.code, "bad_origin");
    const good = await b.fetchWith("/v1/connections/claude", { method: "POST", headers: { ...headers, "x-csrf-token": csrfToken, origin: w.base }, body });
    assert.equal(good.status, 200);
    const trusted = await b.fetchWith("/v1/connections/claude", { method: "DELETE", headers: { "x-csrf-token": csrfToken, origin: "https://trusted.example" } });
    assert.equal(trusted.status, 200);
    const getOk = await b.fetchWith("/v1/providers?mode=secure_local", { headers: { origin: "https://evil.example" } });
    assert.equal(getOk.status, 200, "reads are not CSRF-gated (and CORS blocks reading cross-origin)");
  } finally { w.close(); }
});

test("per-user isolation: connections, chat access and audit are private to each user", async () => {
  const w = await makeWorld();
  try {
    const alice = browser(w), bob = browser(w);
    await alice.signIn(ALICE);
    await bob.signIn(BOB);
    const aCsrf = (await alice.me()).csrfToken, bCsrf = (await bob.me()).csrfToken;
    const json = { "content-type": "application/json" };

    const connect = await alice.fetchWith("/v1/connections/claude", { method: "POST", headers: { ...json, "x-csrf-token": aCsrf }, body: JSON.stringify({ type: "api_key", apiKey: CLAUDE_KEY }) });
    assert.equal(connect.status, 200);
    assert.ok(!(await connect.text()).includes(CLAUDE_KEY));

    const view = async (b) => (await (await b.fetchWith("/v1/providers?mode=standard")).json()).providers.find((p) => p.descriptor.id === "claude");
    assert.equal((await view(alice)).status, "ready");
    assert.equal((await view(bob)).status, "not_connected", "Bob does not see Alice's connection");

    const chat = async (b, csrf) => {
      const res = await b.fetchWith("/v1/chat", { method: "POST", headers: { ...json, "x-csrf-token": csrf }, body: JSON.stringify({ providerId: "claude", model: "claude-x", mode: "standard", contentClass: "general", messages: [{ role: "user", content: "hello" }] }) });
      return (await res.text()).split("\n\n").filter(Boolean).map((x) => JSON.parse(x.replace(/^data: /, "")));
    };
    const aliceEvents = await chat(alice, aCsrf);
    assert.equal(aliceEvents.filter((e) => e.type === "delta").map((e) => e.text).join(""), "hi");
    const bobEvents = await chat(bob, bCsrf);
    assert.equal(bobEvents[0].type, "blocked");
    assert.equal(bobEvents[0].code, "not_connected", "Bob cannot spend Alice's key");

    const bobAudit = await (await bob.fetchWith("/v1/audit?limit=200")).json();
    const aliceAudit = await (await alice.fetchWith("/v1/audit?limit=200")).json();
    const ids = (a) => new Set(a.events.map((e) => e.userId));
    assert.equal(ids(bobAudit).size, 1);
    assert.equal(ids(aliceAudit).size, 1);
    assert.notDeepEqual([...ids(aliceAudit)], [...ids(bobAudit)]);

    // Bob connecting/disconnecting his own does not touch Alice's.
    await bob.fetchWith("/v1/connections/claude", { method: "DELETE", headers: { "x-csrf-token": bCsrf } });
    assert.equal((await view(alice)).status, "ready");
  } finally { w.close(); }
});

test("account linking is bound to the user who started it (another session cannot complete it)", async () => {
  const w = await makeWorld();
  try {
    const alice = browser(w), bob = browser(w);
    await alice.signIn(ALICE);
    await bob.signIn(BOB);
    const aCsrf = (await alice.me()).csrfToken;
    const started = await (await alice.fetchWith("/v1/connections/gemini/oauth/start", { method: "POST", headers: { "content-type": "application/json", "x-csrf-token": aCsrf }, body: "{}" })).json();
    const state = new URL(started.authorizeUrl).searchParams.get("state");
    const stolen = await bob.fetchWith(`/oauth/callback/gemini?code=x&state=${state}`);
    assert.match(stolen.headers.get("location"), /connect_error=gemini/, "Bob cannot finish Alice's linking");
    const anon = await fetch(`${w.base}/oauth/callback/gemini?code=x&state=${state}`, { redirect: "manual" });
    assert.ok([302, 400].includes(anon.status));
    assert.doesNotMatch(anon.headers.get("location") ?? "", /connected=/);
  } finally { w.close(); }
});

test("a configured bearer token still works as a service identity; without one it does not exist", async () => {
  const withToken = await makeWorld({ token: "svc-token" });
  const without = await makeWorld();
  try {
    assert.equal((await fetch(`${withToken.base}/v1/providers?mode=secure_local`, { headers: { authorization: "Bearer svc-token" } })).status, 200);
    assert.equal((await fetch(`${withToken.base}/v1/providers?mode=secure_local`, { headers: { authorization: "Bearer nope" } })).status, 401);
    assert.equal((await fetch(`${without.base}/v1/providers?mode=secure_local`, { headers: { authorization: "Bearer anything" } })).status, 401);
  } finally { withToken.close(); without.close(); }
});

test("Google needs https or localhost: a LAN http address gets an explanation, not a broken redirect", async () => {
  const w = await makeWorld({ publicUrl: "http://192.168.1.20:8787" });
  try {
    const res = await fetch(`${w.base}/auth/google/start`, { redirect: "manual" });
    assert.equal(res.status, 400);
    assert.match(await res.text(), /https:\/\/<\/code> addresses or <code>localhost/);
  } finally { w.close(); }
  const off = await makeWorld({ noGoogle: true });
  try {
    assert.equal((await fetch(`${off.base}/auth/google/start`, { redirect: "manual" })).status, 404);
  } finally { off.close(); }
});

test("configuration comes from WINDSWORD_GOOGLE_* only and needs both values", () => {
  assert.equal(googleLoginFromEnv({}), undefined);
  assert.equal(googleLoginFromEnv({ WINDSWORD_GOOGLE_CLIENT_ID: "id" }), undefined);
  assert.equal(googleLoginFromEnv({ GOOGLE_CLIENT_ID: "id", GOOGLE_CLIENT_SECRET: "s" }), undefined, "the generic GOOGLE_* names are deliberately not read");
  const c = googleLoginFromEnv({ WINDSWORD_GOOGLE_CLIENT_ID: " id ", WINDSWORD_GOOGLE_CLIENT_SECRET: " sec " });
  assert.deepEqual([c.clientId, c.clientSecret], ["id", "sec"]);
  assert.equal(c.authorizeUrl, "https://accounts.google.com/o/oauth2/v2/auth");
  assert.deepEqual(parseCookies("a=1; b=2; a=3; junk"), { a: "1", b: "2" });
});
