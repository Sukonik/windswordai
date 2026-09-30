// Fake vendor APIs (Anthropic-shaped and OpenAI-shaped) for offline end-to-end tests.
// Run standalone:  node scripts/fake-providers.mjs 9911
import { createHash, createSign, generateKeyPairSync, randomBytes } from "node:crypto";
import { createServer } from "node:http";

export const FAKE_KEYS = { claude: "sk-fake-claude-000111", openai: "sk-fake-openai-000222" };
export const FAKE_GOOGLE = { clientId: "e2e-google-client.apps.googleusercontent.com", clientSecret: "e2e-google-secret-not-real" };
export const FAKE_OAUTH = { clientId: "e2e-client", clientSecret: "e2e-client-secret", scope: "scope.generate" };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function startFakeProviders(port = 0) {
  const requests = [];
  // Fake OAuth 2.0 authorization server: verifies PKCE S256 like a real one.
  const codes = new Map(); // code -> { challenge, redirectUri }
  // Fake Google (sign-in): signs real RS256 ID tokens and serves a JWKS. Identity is chosen by the test.
  const gkeys = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const gjwk = { ...gkeys.publicKey.export({ format: "jwk" }), kid: "e2e-key", alg: "RS256", use: "sig" };
  const google = { next: { sub: "sub-alice", email: "alice@example.com", name: "Alice Example" }, codes: new Map(), logins: [], tokenGrants: [] };
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const oauth = { authorizations: [], tokenGrants: [], revocations: [], accessTokens: new Set(), refreshTokens: new Set() };
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, "http://x");
    let body = "";
    for await (const c of req) body += c;
    requests.push({ method: req.method, path: url.pathname, headers: req.headers, body });
    const send = (status, obj) => { res.writeHead(status, { "content-type": "application/json" }); res.end(JSON.stringify(obj)); };



    // ---- Fake Google sign-in (OpenID Connect)
    if (url.pathname === "/google/_next" && req.method === "POST") { google.next = JSON.parse(body); return send(200, { ok: true }); }
    if (url.pathname === "/google/certs") return send(200, { keys: [gjwk] });
    if (url.pathname === "/google/authorize" && req.method === "GET") {
      const q = url.searchParams;
      google.logins.push({ scope: q.get("scope"), method: q.get("code_challenge_method"), hasNonce: Boolean(q.get("nonce")), clientId: q.get("client_id") });
      if (q.get("client_id") !== FAKE_GOOGLE.clientId || q.get("code_challenge_method") !== "S256") return send(400, { error: "invalid_request" });
      const back = new URL(q.get("redirect_uri"));
      back.searchParams.set("state", q.get("state"));
      if (google.next.deny) back.searchParams.set("error", "access_denied");
      else {
        const code = `gcode-${randomBytes(6).toString("hex")}`;
        google.codes.set(code, { challenge: q.get("code_challenge"), nonce: q.get("nonce"), redirectUri: q.get("redirect_uri"), identity: google.next });
        back.searchParams.set("code", code);
      }
      res.writeHead(302, { location: back.toString() });
      return res.end();
    }
    if (url.pathname === "/google/token" && req.method === "POST") {
      const f = new URLSearchParams(body);
      google.tokenGrants.push({ hasVerifier: Boolean(f.get("code_verifier")), secretOk: f.get("client_secret") === FAKE_GOOGLE.clientSecret });
      const entry = google.codes.get(f.get("code"));
      google.codes.delete(f.get("code"));
      const pkce = entry && createHash("sha256").update(f.get("code_verifier") ?? "").digest("base64url") === entry.challenge;
      if (!entry || !pkce || f.get("client_secret") !== FAKE_GOOGLE.clientSecret || f.get("client_id") !== FAKE_GOOGLE.clientId) return send(400, { error: "invalid_grant" });
      const now = Math.floor(Date.now() / 1000);
      const payload = { iss: "https://accounts.google.com", aud: FAKE_GOOGLE.clientId, azp: FAKE_GOOGLE.clientId, sub: entry.identity.sub, email: entry.identity.email, email_verified: entry.identity.email_verified ?? true, name: entry.identity.name, nonce: entry.nonce, iat: now, exp: now + 3600 };
      const input = `${b64({ alg: "RS256", kid: "e2e-key", typ: "JWT" })}.${b64(payload)}`;
      const idToken = `${input}.${createSign("RSA-SHA256").update(input).sign(gkeys.privateKey).toString("base64url")}`;
      return send(200, { access_token: "ya29.e2e-google-access", id_token: idToken, expires_in: 3600 });
    }

    // ---- Fake OAuth authorization server (auto-approves; a real IdP would show a consent screen)
    if (url.pathname === "/oauth/authorize" && req.method === "GET") {
      const q = url.searchParams;
      oauth.authorizations.push({ clientId: q.get("client_id"), scope: q.get("scope"), method: q.get("code_challenge_method"), hasState: Boolean(q.get("state")), redirectUri: q.get("redirect_uri") });
      if (q.get("client_id") !== FAKE_OAUTH.clientId || q.get("response_type") !== "code" || q.get("code_challenge_method") !== "S256") return send(400, { error: "invalid_request" });
      const code = `code-${randomBytes(6).toString("hex")}`;
      codes.set(code, { challenge: q.get("code_challenge"), redirectUri: q.get("redirect_uri") });
      const back = new URL(q.get("redirect_uri"));
      if (q.get("deny") === "1") back.searchParams.set("error", "access_denied"); else back.searchParams.set("code", code);
      back.searchParams.set("state", q.get("state"));
      res.writeHead(302, { location: back.toString() });
      return res.end();
    }
    if (url.pathname === "/oauth/token" && req.method === "POST") {
      const f = new URLSearchParams(body);
      oauth.tokenGrants.push({ grant: f.get("grant_type"), hasVerifier: Boolean(f.get("code_verifier")), clientSecretOk: f.get("client_secret") === FAKE_OAUTH.clientSecret });
      if (f.get("client_id") !== FAKE_OAUTH.clientId || f.get("client_secret") !== FAKE_OAUTH.clientSecret) return send(401, { error: "invalid_client" });
      if (f.get("grant_type") === "authorization_code") {
        const entry = codes.get(f.get("code"));
        codes.delete(f.get("code")); // codes are single use
        const ok = entry && entry.redirectUri === f.get("redirect_uri") && createHash("sha256").update(f.get("code_verifier") ?? "").digest("base64url") === entry.challenge;
        if (!ok) return send(400, { error: "invalid_grant" });
        const access = `fake-oauth-access-${randomBytes(4).toString("hex")}`;
        const refresh = `fake-oauth-refresh-${randomBytes(4).toString("hex")}`;
        oauth.accessTokens.add(access); oauth.refreshTokens.add(refresh);
        return send(200, { access_token: access, refresh_token: refresh, expires_in: 3600, scope: FAKE_OAUTH.scope });
      }
      if (f.get("grant_type") === "refresh_token" && oauth.refreshTokens.has(f.get("refresh_token"))) {
        const access = `fake-oauth-access-${randomBytes(4).toString("hex")}`;
        oauth.accessTokens.add(access);
        return send(200, { access_token: access, expires_in: 3600 });
      }
      return send(400, { error: "invalid_grant" });
    }
    if (url.pathname === "/oauth/revoke" && req.method === "POST") {
      const f = new URLSearchParams(body);
      oauth.revocations.push({ token: f.get("token") });
      oauth.refreshTokens.delete(f.get("token")); oauth.accessTokens.delete(f.get("token"));
      res.writeHead(200); return res.end();
    }

    // ---- Gemini-shaped API that accepts ONLY an OAuth bearer token (mounted under /gemini)
    if (url.pathname.startsWith("/gemini/")) {
      const bearer = (req.headers.authorization ?? "").replace(/^Bearer /, "");
      if (!oauth.accessTokens.has(bearer)) return send(401, { error: "bad token" });
      if (url.pathname === "/gemini/v1beta/models") return send(200, { models: [{ name: "models/gemini-fake-pro", displayName: "Gemini Fake Pro", supportedGenerationMethods: ["generateContent"] }, { name: "models/gemini-fake-flash", displayName: "Gemini Fake Flash", supportedGenerationMethods: ["generateContent"] }] });
      if (url.pathname.includes(":streamGenerateContent") && req.method === "POST") {
        const payload = JSON.parse(body);
        const last = payload.contents.at(-1).parts[0].text;
        res.writeHead(200, { "content-type": "text/event-stream" });
        const words = `Gemini (fake upstream, linked account) says: on "${last.slice(0, 60)}", the clause looks enforceable.`.split(" ");
        for (const w of words) { res.write(`data: ${JSON.stringify({ candidates: [{ content: { parts: [{ text: w + " " }] } }] })}\n\n`); await sleep(9); }
        res.write(`data: ${JSON.stringify({ candidates: [{ content: { parts: [{ text: "" }] }, finishReason: "STOP" }], usageMetadata: { promptTokenCount: 17, candidatesTokenCount: words.length } })}\n\n`);
        return res.end();
      }
    }

    // ---- Anthropic-shaped
    if (url.pathname === "/v1/models") {
      if (req.headers["x-api-key"]) {
        if (req.headers["x-api-key"] !== FAKE_KEYS.claude) return send(401, { error: { type: "authentication_error" } });
        return send(200, { data: [{ id: "claude-fake-sonnet", display_name: "Claude Fake Sonnet" }, { id: "claude-fake-haiku", display_name: "Claude Fake Haiku" }] });
      }
      if (req.headers.authorization) {
        if (req.headers.authorization !== `Bearer ${FAKE_KEYS.openai}`) return send(401, { error: "bad key" });
        return send(200, { data: [{ id: "fake-gpt-large" }, { id: "fake-gpt-mini" }, { id: "text-embedding-fake" }] });
      }
      return send(401, {});
    }
    if (url.pathname === "/v1/messages" && req.method === "POST") {
      if (req.headers["x-api-key"] !== FAKE_KEYS.claude) return send(401, {});
      const payload = JSON.parse(body);
      const last = payload.messages.at(-1).content;
      if (last.includes("[503]")) return send(529, { error: { type: "overloaded_error" } });
      res.writeHead(200, { "content-type": "text/event-stream" });
      const ev = (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
      ev("message_start", { type: "message_start", message: { usage: { input_tokens: 21 } } });
      const words = `Claude (fake upstream) says: regarding "${last.slice(0, 60)}", the notice clause requires written notice delivered to the address in section 12.`.split(" ");
      for (const w of words) { ev("content_block_delta", { type: "content_block_delta", delta: { type: "text_delta", text: w + " " } }); await sleep(12); }
      ev("message_delta", { type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: words.length } });
      ev("message_stop", { type: "message_stop" });
      return res.end();
    }

    // ---- OpenAI-shaped
    if (url.pathname === "/v1/chat/completions" && req.method === "POST") {
      if (req.headers.authorization !== `Bearer ${FAKE_KEYS.openai}`) return send(401, {});
      const payload = JSON.parse(body);
      const last = payload.messages.at(-1).content;
      res.writeHead(200, { "content-type": "text/event-stream" });
      const data = (obj) => res.write(`data: ${typeof obj === "string" ? obj : JSON.stringify(obj)}\n\n`);
      const words = `OpenAI (fake upstream) says: for "${last.slice(0, 60)}", the clause is enforceable if notice is given in writing.`.split(" ");
      for (const w of words) { data({ choices: [{ delta: { content: w + " " } }] }); await sleep(9); }
      data({ choices: [{ delta: {}, finish_reason: "stop" }] });
      data({ choices: [], usage: { prompt_tokens: 19, completion_tokens: words.length } });
      data("[DONE]");
      return res.end();
    }
    send(404, { error: "not found" });
  });
  return new Promise((resolve) => server.listen(port, "127.0.0.1", () => resolve({ server, port: server.address().port, requests, oauth, google })));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { port } = await startFakeProviders(Number(process.argv[2] ?? 9911));
  console.log(`Fake provider upstreams on http://127.0.0.1:${port} (claude key ${FAKE_KEYS.claude}, openai key ${FAKE_KEYS.openai})`);
}
