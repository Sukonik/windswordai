import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { Gateway } from "../gateway/src/gateway.ts";
import { AuditLog } from "../gateway/src/audit.ts";
import { OAuthManager, oauthConfigsFromEnv, sanitizeReturnTo } from "../gateway/src/oauth.ts";
import { createHttpServer } from "../gateway/src/http.ts";
import { createDefaultRegistry } from "../gateway/src/providers/index.ts";
import { MemoryConnectionStore, MemorySecretStore } from "../gateway/src/stores.ts";
import { collect, fakeFetch, jsonResponse, sseResponse } from "./helpers.mjs";

const CFG = {
  clientId: "client-123",
  clientSecret: "shh-client-secret",
  scopes: ["scope.a", "scope.b"],
  authorizeUrl: "https://idp.example/authorize",
  tokenUrl: "https://idp.example/token",
  revokeUrl: "https://idp.example/revoke",
  baseUrl: "https://gemini.example",
};
const ACCESS = "access-token-AAAAAAAAAA";
const REFRESHED = "access-token-REFRESHED-BBBB";
const REFRESH = "refresh-token-RRRRRRRRRR";
const REDIRECT_BASE = "http://127.0.0.1:8787";

/** Fake IdP + fake Gemini-shaped API. Verifies PKCE like a real authorization server. */
function makeWorld({ now = () => Date.now(), tokenStatus = 200, expiresIn = 3600 } = {}) {
  const state = { challenges: new Map(), tokenCalls: [], revokeCalls: [], apiAuth: [] };
  const fetchImpl = fakeFetch([
    [(u) => u === CFG.tokenUrl, async (_u, init) => {
      const form = new URLSearchParams(init.body.toString());
      state.tokenCalls.push(Object.fromEntries(form));
      if (tokenStatus !== 200) return jsonResponse({ error: "invalid_grant" }, tokenStatus);
      if (form.get("grant_type") === "authorization_code") {
        const expected = state.challenges.get(form.get("code"));
        const actual = createHash("sha256").update(form.get("code_verifier") ?? "").digest("base64url");
        if (!expected || expected !== actual) return jsonResponse({ error: "invalid_grant" }, 400);
        return jsonResponse({ access_token: ACCESS, refresh_token: REFRESH, expires_in: expiresIn, scope: CFG.scopes.join(" ") });
      }
      if (form.get("grant_type") === "refresh_token" && form.get("refresh_token") === REFRESH) {
        await new Promise((r) => setTimeout(r, 15));
        return jsonResponse({ access_token: REFRESHED, expires_in: 3600 });
      }
      return jsonResponse({ error: "invalid_grant" }, 400);
    }],
    [(u) => u === CFG.revokeUrl, (_u, init) => { state.revokeCalls.push(Object.fromEntries(new URLSearchParams(init.body.toString()))); return new Response("", { status: 200 }); }],
    [(u) => u.startsWith("https://gemini.example/v1beta/models?"), (_u, init) => { state.apiAuth.push(init.headers); return jsonResponse({ models: [{ name: "models/gem-oauth", supportedGenerationMethods: ["generateContent"] }] }); }],
    [(u) => u.includes(":streamGenerateContent"), (_u, init) => { state.apiAuth.push(init.headers); return sseResponse([{ data: { candidates: [{ content: { parts: [{ text: "linked" }] }, finishReason: "STOP" }] } }]); }],
  ]);
  const oauth = new OAuthManager({ configs: { gemini: CFG }, fetch: fetchImpl, now });
  const secrets = new MemorySecretStore();
  const connections = new MemoryConnectionStore();
  const lines = [];
  const audit = new AuditLog((l) => lines.push(l));
  const gw = new Gateway({ registry: createDefaultRegistry({ mockDelayMs: 0 }), fetch: fetchImpl, oauth, secrets, connections, audit });
  return { state, fetchImpl, oauth, secrets, connections, audit, lines, gw };
}

/** Play the browser + IdP: visit authorize URL, record PKCE challenge, return the redirect params. */
function idpAuthorize(world, authorizeUrl, { code = "code-1" } = {}) {
  const u = new URL(authorizeUrl);
  world.state.challenges.set(code, u.searchParams.get("code_challenge"));
  return { code, state: u.searchParams.get("state"), url: u };
}

test("authorization URL has PKCE S256, state, scopes and never exposes the verifier or secret", () => {
  const { gw } = makeWorld();
  const url = new URL(gw.beginOAuth("gemini", { returnTo: "/chat/", redirectBase: REDIRECT_BASE }));
  const q = url.searchParams;
  assert.equal(url.origin + url.pathname, CFG.authorizeUrl);
  assert.equal(q.get("response_type"), "code");
  assert.equal(q.get("client_id"), CFG.clientId);
  assert.equal(q.get("redirect_uri"), `${REDIRECT_BASE}/oauth/callback/gemini`);
  assert.equal(q.get("scope"), "scope.a scope.b");
  assert.equal(q.get("code_challenge_method"), "S256");
  assert.ok(q.get("state").length >= 24 && q.get("code_challenge").length >= 40);
  assert.ok(!url.toString().includes(CFG.clientSecret));
});

test("full flow: link account, tokens stored encrypted-side only, chat uses a Bearer token", async () => {
  const w = makeWorld();
  const start = w.gw.beginOAuth("gemini", { returnTo: "/chat/", redirectBase: REDIRECT_BASE });
  const { code, state } = idpAuthorize(w, start);
  const result = await w.gw.completeOAuth("gemini", { code, state });
  assert.deepEqual(result, { ok: true, returnTo: "/chat/" });

  // PKCE exchange really happened, with the client secret sent server-side.
  const exchange = w.state.tokenCalls[0];
  assert.equal(exchange.grant_type, "authorization_code");
  assert.equal(exchange.client_secret, CFG.clientSecret);
  assert.ok(exchange.code_verifier);

  const views = await w.gw.listProviders("standard");
  const view = views.find((v) => v.descriptor.id === "gemini");
  assert.equal(view.status, "ready");
  assert.equal(view.connection.type, "oauth");
  assert.equal(view.oauth.available, true);
  assert.deepEqual(view.models.map((m) => m.id), ["gem-oauth"]);
  const dump = JSON.stringify(views) + JSON.stringify(w.audit.recent(100)) + w.lines.join("\n");
  for (const secret of [ACCESS, REFRESH, CFG.clientSecret]) assert.ok(!dump.includes(secret), `leaked ${secret}`);
  const record = await w.connections.get("gemini");
  assert.ok(!JSON.stringify(record).includes(ACCESS), "connection record must hold only an opaque reference");

  const events = await collect(w.gw.chat({ providerId: "gemini", model: "gem-oauth", mode: "standard", contentClass: "general", messages: [{ role: "user", content: "hi" }] }));
  assert.equal(events.filter((e) => e.type === "delta").map((e) => e.text).join(""), "linked");
  const headers = w.state.apiAuth.at(-1);
  assert.equal(headers.authorization, `Bearer ${ACCESS}`);
  assert.equal(headers["x-goog-api-key"], undefined, "OAuth must not be sent as an API key");
});

test("state is single-use, provider-bound and expires; errors never exchange a code", async () => {
  let t = 1_000_000;
  const w = makeWorld({ now: () => t });
  const mk = () => idpAuthorize(w, w.gw.beginOAuth("gemini", { returnTo: "/settings/", redirectBase: REDIRECT_BASE }), { code: `c${Math.random()}` });

  const a = mk();
  assert.equal((await w.gw.completeOAuth("gemini", { code: a.code, state: a.state })).ok, true);
  await assert.rejects(() => w.oauth.complete("gemini", { code: a.code, state: a.state }), /invalid or has expired/, "replay");

  const b = mk();
  await assert.rejects(() => w.oauth.complete("claude", { code: b.code, state: b.state }), /invalid or has expired/, "wrong provider");
  await assert.rejects(() => w.oauth.complete("gemini", { code: b.code, state: b.state }), /invalid or has expired/, "state consumed even on a wrong-provider attempt");

  const c = mk();
  t += 11 * 60_000;
  await assert.rejects(() => w.oauth.complete("gemini", { code: c.code, state: c.state }), /invalid or has expired/, "expired");
  await assert.rejects(() => w.oauth.complete("gemini", { code: "x", state: "not-a-real-state" }), /invalid or has expired/, "unknown");

  const before = w.state.tokenCalls.length;
  const d = mk();
  const denied = await w.gw.completeOAuth("gemini", { error: "access_denied", state: d.state });
  assert.deepEqual(denied, { ok: false, returnTo: "/settings/" });
  assert.equal(w.state.tokenCalls.length, before, "no token request when the user denies");
});

test("PKCE: a wrong verifier is rejected by the authorization server", async () => {
  const w = makeWorld();
  const start = w.gw.beginOAuth("gemini", { redirectBase: REDIRECT_BASE });
  const { state } = idpAuthorize(w, start, { code: "good" });
  w.state.challenges.set("good", "some-other-challenge"); // IdP remembers a different challenge
  const result = await w.gw.completeOAuth("gemini", { code: "good", state });
  assert.equal(result.ok, false);
  assert.equal((await w.gw.listProviders("standard")).find((v) => v.descriptor.id === "gemini").status, "not_connected");
});

test("returnTo only allows same-site relative paths (no open redirect)", () => {
  assert.equal(sanitizeReturnTo("/chat/?x=1"), "/chat/?x=1");
  for (const bad of ["//evil.example", "https://evil.example", "http://evil.example/x", "/\\evil.example", "javascript:alert(1)", "chat", "/ok\r\nSet-Cookie: x=1", "", undefined, null, 5, "/" + "a".repeat(400)]) {
    assert.equal(sanitizeReturnTo(bad), "/settings/", String(bad).slice(0, 30));
  }
});

test("expired access tokens are refreshed once (even for concurrent chats) and re-stored encrypted-side", async () => {
  let now = 5_000_000;
  const w = makeWorld({ now: () => now, expiresIn: 30 });
  const { code, state } = idpAuthorize(w, w.gw.beginOAuth("gemini", { redirectBase: REDIRECT_BASE }));
  await w.gw.completeOAuth("gemini", { code, state });
  const oldRef = (await w.connections.get("gemini")).secretRef;

  // Access token expires in 30s (< 60s skew) relative to real time, so the next call must refresh.
  const req = { providerId: "gemini", model: "gem-oauth", mode: "standard", contentClass: "general", messages: [{ role: "user", content: "hi" }] };
  const [a, b] = await Promise.all([collect(w.gw.chat(req)), collect(w.gw.chat(req))]);
  assert.equal(a.at(-1).type, "done");
  assert.equal(b.at(-1).type, "done");
  const refreshes = w.state.tokenCalls.filter((c) => c.grant_type === "refresh_token");
  assert.equal(refreshes.length, 1, "concurrent chats share one refresh");
  assert.equal(w.state.apiAuth.at(-1).authorization, `Bearer ${REFRESHED}`);
  const newRef = (await w.connections.get("gemini")).secretRef;
  assert.notEqual(newRef, oldRef);
  assert.equal(await w.secrets.get(oldRef), undefined, "old token material deleted");
  assert.ok(JSON.parse(await w.secrets.get(newRef)).refreshToken === REFRESH, "refresh token kept when not rotated");
  void now;
});

test("a failed refresh degrades to a typed error event, not an exception", async () => {
  const w = makeWorld({ expiresIn: 30 });
  const { code, state } = idpAuthorize(w, w.gw.beginOAuth("gemini", { redirectBase: REDIRECT_BASE }));
  await w.gw.completeOAuth("gemini", { code, state });
  // Break the refresh token on the IdP side.
  const rec = await w.connections.get("gemini");
  const tokens = JSON.parse(await w.secrets.get(rec.secretRef));
  await w.secrets.delete(rec.secretRef);
  const ref = await w.secrets.put(JSON.stringify({ ...tokens, refreshToken: "revoked-refresh" }));
  await w.connections.set({ ...rec, secretRef: ref });
  const events = await collect(w.gw.chat({ providerId: "gemini", model: "gem-oauth", mode: "standard", contentClass: "general", messages: [{ role: "user", content: "hi" }] }));
  assert.equal(events.at(-1).type, "error");
  assert.equal(events.at(-1).code, "auth_failed");
});

test("disconnect revokes at the provider and deletes local token material (even if revoke fails)", async () => {
  const w = makeWorld();
  const { code, state } = idpAuthorize(w, w.gw.beginOAuth("gemini", { redirectBase: REDIRECT_BASE }));
  await w.gw.completeOAuth("gemini", { code, state });
  const ref = (await w.connections.get("gemini")).secretRef;
  await w.gw.disconnect("gemini");
  assert.equal(w.state.revokeCalls.length, 1);
  assert.equal(w.state.revokeCalls[0].token, REFRESH);
  assert.equal(await w.secrets.get(ref), undefined);
  assert.equal(await w.connections.get("gemini"), undefined);

  const broken = new OAuthManager({ configs: { gemini: CFG }, fetch: async () => { throw new Error("offline"); } });
  assert.equal(await broken.revoke("gemini", { accessToken: "x" }), false, "revoke failure is swallowed");
});

test("direct connect() cannot be used for OAuth, and unconfigured providers report no account linking", async () => {
  const w = makeWorld();
  await assert.rejects(() => w.gw.connect("gemini", { type: "oauth" }), /authorization flow/);
  assert.throws(() => w.gw.beginOAuth("claude", { redirectBase: REDIRECT_BASE }), /not enabled|not available/);
  const views = await w.gw.listProviders("standard");
  assert.equal(views.find((v) => v.descriptor.id === "gemini").oauth.available, true);
  assert.equal(views.find((v) => v.descriptor.id === "claude").oauth.available, false);
});

test("OAuth config comes from the environment; scopes are never guessed", () => {
  const ids = ["claude", "openai", "gemini", "mistral"];
  assert.deepEqual(oauthConfigsFromEnv({}, ids), {});
  // Gemini defaults to Google endpoints but still needs an explicit scope list.
  assert.deepEqual(oauthConfigsFromEnv({ WINDSWORD_OAUTH_GEMINI_CLIENT_ID: "id" }, ids), {});
  const g = oauthConfigsFromEnv({ WINDSWORD_OAUTH_GEMINI_CLIENT_ID: "id", WINDSWORD_OAUTH_GEMINI_CLIENT_SECRET: "sec", WINDSWORD_OAUTH_GEMINI_SCOPES: "s1,s2 s3" }, ids).gemini;
  assert.equal(g.authorizeUrl, "https://accounts.google.com/o/oauth2/v2/auth");
  assert.deepEqual(g.scopes, ["s1", "s2", "s3"]);
  assert.equal(g.extraAuthParams.access_type, "offline");
  // No vendor endpoints are assumed for anyone else.
  assert.deepEqual(oauthConfigsFromEnv({ WINDSWORD_OAUTH_CLAUDE_CLIENT_ID: "id", WINDSWORD_OAUTH_CLAUDE_SCOPES: "x" }, ids), {});
  const c = oauthConfigsFromEnv({ WINDSWORD_OAUTH_CLAUDE_CLIENT_ID: "id", WINDSWORD_OAUTH_CLAUDE_SCOPES: "x", WINDSWORD_OAUTH_CLAUDE_AUTHORIZE_URL: "https://a/authorize", WINDSWORD_OAUTH_CLAUDE_TOKEN_URL: "https://a/token", WINDSWORD_OAUTH_CLAUDE_EXTRA_PARAMS: "not json" }, ids).claude;
  assert.equal(c.tokenUrl, "https://a/token");
  assert.equal(c.extraAuthParams, undefined);
});

test("HTTP: start returns the authorize URL; callback links the account and 302s back to the exact route", async () => {
  const w = makeWorld();
  const server = createHttpServer({ gateway: w.gw });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const startRes = await fetch(`${base}/v1/connections/gemini/oauth/start`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ returnTo: "/chat/?from=picker" }) });
    const { authorizeUrl } = await startRes.json();
    const auth = idpAuthorize(w, authorizeUrl, { code: "http-code" });
    assert.equal(auth.url.searchParams.get("redirect_uri"), `${base}/oauth/callback/gemini`);

    const cb = await fetch(`${base}/oauth/callback/gemini?code=http-code&state=${auth.state}`, { redirect: "manual" });
    assert.equal(cb.status, 302);
    assert.equal(cb.headers.get("location"), "/chat/?from=picker&connected=gemini");
    assert.equal(cb.headers.get("referrer-policy"), "no-referrer");

    const replay = await fetch(`${base}/oauth/callback/gemini?code=http-code&state=${auth.state}`, { redirect: "manual" });
    assert.equal(replay.status, 302);
    assert.equal(replay.headers.get("location"), "/settings/?connect_error=gemini", "replay is refused and sent to a fixed safe route");

    const evil = await (await fetch(`${base}/v1/connections/gemini/oauth/start`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ returnTo: "https://evil.example/" }) })).json();
    const evilAuth = idpAuthorize(w, evil.authorizeUrl, { code: "evil-code" });
    const evilCb = await fetch(`${base}/oauth/callback/gemini?code=evil-code&state=${evilAuth.state}`, { redirect: "manual" });
    assert.match(evilCb.headers.get("location"), /^\/settings\/\?connected=gemini$/);

    const denied = await (await fetch(`${base}/v1/connections/gemini/oauth/start`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" })).json();
    const deniedAuth = idpAuthorize(w, denied.authorizeUrl);
    const dcb = await fetch(`${base}/oauth/callback/gemini?error=access_denied&state=${deniedAuth.state}`, { redirect: "manual" });
    assert.match(dcb.headers.get("location"), /connect_error=gemini/);
  } finally {
    server.close();
  }
});

test("HTTP: OAuth start requires the gateway token when one is set; callback relies on state instead", async () => {
  const w = makeWorld();
  const server = createHttpServer({ gateway: w.gw, token: "tok" });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    assert.equal((await fetch(`${base}/v1/connections/gemini/oauth/start`, { method: "POST", body: "{}" })).status, 401);
    const bad = await fetch(`${base}/oauth/callback/gemini?code=x&state=nope`, { redirect: "manual" });
    assert.equal(bad.status, 302);
    assert.equal(bad.headers.get("location"), "/settings/?connect_error=gemini");
    assert.equal((await fetch(`${base}/oauth/callback/unknownprovider?code=x&state=nope`, { redirect: "manual" })).status, 400, "unknown provider gets the static expired-link page");
  } finally {
    server.close();
  }
});
