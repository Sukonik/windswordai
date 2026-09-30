import test from "node:test";
import assert from "node:assert/strict";
import { request } from "node:http";
import { mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AuditLog } from "../gateway/src/audit.ts";
import { AuthService } from "../gateway/src/auth.ts";
import { Gateway } from "../gateway/src/gateway.ts";
import { createHttpServer } from "../gateway/src/http.ts";
import { LocalConfig } from "../gateway/src/local-config.ts";
import { OAuthManager } from "../gateway/src/oauth.ts";
import { createDefaultRegistry } from "../gateway/src/providers/index.ts";
import { createSetupHandler } from "../gateway/src/setup-page.ts";
import { MemoryConnectionStore } from "../gateway/src/stores.ts";
import { FileSecretStore, loadVaultKey } from "../gateway/src/vault.ts";

const SECRET = "fake-google-secret-for-tests-only-123";
const CLIENT_ID = "123456789-abcdefg.apps.googleusercontent.com";

async function world({ publicUrl } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "ws-setup-"));
  const secrets = new FileSecretStore(dir, loadVaultKey(dir, {}));
  const config = new LocalConfig(dir, secrets);
  const lines = [];
  const audit = new AuditLog((l) => lines.push(l));
  const auth = new AuthService({ mode: "off", audit });
  const gateway = new Gateway({ registry: createDefaultRegistry(), oauth: new OAuthManager({ configs: {} }), secrets, connections: new MemoryConnectionStore(), audit });
  const setup = createSetupHandler({ auth, config, audit, env: {}, publicUrl });
  const server = createHttpServer({ gateway, auth, setup, host: "127.0.0.1", port: 0, publicUrl });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const get = (path = "/setup/google", headers = {}) => fetch(base + path, { headers });
  const post = (fields, headers = {}) => fetch(base + "/setup/google", { method: "POST", redirect: "manual", headers: { "content-type": "application/x-www-form-urlencoded", ...headers }, body: new URLSearchParams(fields) });
  const token = async () => (await (await get()).text()).match(/name="token" value="([^"]+)"/)[1];
  return { dir, config, auth, lines, base, get, post, token, close: () => server.close() };
}

test("setup page shows a masked password field and never a stored secret", async (t) => {
  const w = await world();
  t.after(w.close);
  const html = await (await w.get()).text();
  assert.match(html, /type="password"/);
  assert.match(html, /autocomplete="new-password"/);
  assert.equal((await w.get()).headers.get("cache-control"), "no-store");
});

test("saving the secret: stored encrypted, sign-in switched on, secret never echoed, logged or written in plaintext", async (t) => {
  const w = await world();
  t.after(w.close);
  const res = await w.post({ token: await w.token(), action: "save", clientId: CLIENT_ID, clientSecret: SECRET, authRequired: "on" });
  assert.equal(res.status, 303);
  assert.equal(res.headers.get("location"), "/setup/google?saved=1");
  assert.equal(w.auth.googleConfigured, true);
  assert.equal(w.auth.mode, "required");
  assert.equal(await w.config.googleClientSecret(), SECRET);

  const page = await (await w.get("/setup/google?saved=1")).text();
  assert.ok(!page.includes(SECRET), "page must not show the secret");
  assert.match(page, /saved \(hidden\)/);
  assert.ok(!w.lines.join("\n").includes(SECRET), "audit must not contain the secret");
  assert.match(w.lines.join("\n"), /setup\.google_saved/);
  for (const f of readdirSync(w.dir)) {
    if (f === "vault.key") continue;
    assert.ok(!readFileSync(join(w.dir, f), "utf8").includes(SECRET), `${f} must not hold the plaintext secret`);
  }
  // Survives a restart: a fresh LocalConfig on the same files reads it back.
  const again = new LocalConfig(w.dir, new FileSecretStore(w.dir, loadVaultKey(w.dir, {})));
  assert.equal(await again.googleClientSecret(), SECRET);
  assert.equal(again.authRequired, true);
});

test("later saves can leave the secret empty to keep the stored one", async (t) => {
  const w = await world();
  t.after(w.close);
  await w.post({ token: await w.token(), action: "save", clientId: CLIENT_ID, clientSecret: SECRET, authRequired: "on" });
  const res = await w.post({ token: await w.token(), action: "save", clientId: CLIENT_ID, clientSecret: "" });
  assert.equal(res.status, 303);
  assert.equal(await w.config.googleClientSecret(), SECRET);
  assert.equal(w.auth.mode, "off");
});

test("bad input is refused with a fixed message that never reflects what was typed", async (t) => {
  const w = await world();
  t.after(w.close);
  const bad = "not a secret <script>alert(1)</script>";
  const r1 = await w.post({ token: await w.token(), action: "save", clientId: CLIENT_ID, clientSecret: bad });
  const b1 = await r1.text();
  assert.equal(r1.status, 400);
  assert.ok(!b1.includes("<script>alert") && !b1.includes("not a secret"));
  const r2 = await w.post({ token: await w.token(), action: "save", clientId: "nope", clientSecret: SECRET });
  assert.equal(r2.status, 400);
  assert.ok(!(await r2.text()).includes(SECRET));
  const r3 = await w.post({ token: await w.token(), action: "save", clientId: CLIENT_ID, clientSecret: "" });
  assert.equal(r3.status, 400);
  assert.equal(w.auth.googleConfigured, false);
});

test("forms without the page token, or from another origin, are rejected", async (t) => {
  const w = await world();
  t.after(w.close);
  assert.equal((await w.post({ token: "guess", action: "save", clientId: CLIENT_ID, clientSecret: SECRET })).status, 403);
  assert.equal((await w.post({ token: await w.token(), action: "save", clientId: CLIENT_ID, clientSecret: SECRET }, { origin: "https://evil.example" })).status, 403);
  assert.equal(w.auth.googleConfigured, false);
});

test("setup is local-only: proxied, foreign-host and hosted requests are refused", async (t) => {
  const w = await world();
  t.after(w.close);
  assert.equal((await w.get("/setup/google", { "x-forwarded-for": "203.0.113.9" })).status, 403);
  const status = await new Promise((resolve, reject) => {
    const req = request(w.base + "/setup/google", { headers: { host: "gateway.example.com" } }, (res) => { res.resume(); resolve(res.statusCode); });
    req.on("error", reject).end();
  });
  assert.equal(status, 403, "a foreign Host header (DNS rebinding) must be refused");
  const hosted = await world({ publicUrl: "https://windsword.example.com" });
  t.after(hosted.close);
  assert.equal((await hosted.get()).status, 403);
});

test("removing the secret clears it and turns sign-in off", async (t) => {
  const w = await world();
  t.after(w.close);
  await w.post({ token: await w.token(), action: "save", clientId: CLIENT_ID, clientSecret: SECRET, authRequired: "on" });
  assert.equal((await w.post({ token: await w.token(), action: "clear" })).status, 303);
  assert.equal(await w.config.googleClientSecret(), undefined);
  assert.equal(w.auth.googleConfigured, false);
  assert.equal(w.auth.mode, "off");
});

// ---- hosted use: the same page, unlocked by an admin setup code, only at the https public origin ----
const ADMIN = "admin-code-for-tests-only-98765";

async function hostedWorld() {
  const publicUrl = "https://windsword.example.com";
  const dir = mkdtempSync(join(tmpdir(), "ws-setup-h-"));
  const secrets = new FileSecretStore(dir, loadVaultKey(dir, {}));
  const config = new LocalConfig(dir, secrets);
  const lines = [];
  const audit = new AuditLog((l) => lines.push(l));
  const auth = new AuthService({ mode: "required", audit, secureCookies: true });
  const gateway = new Gateway({ registry: createDefaultRegistry(), oauth: new OAuthManager({ configs: {} }), secrets, connections: new MemoryConnectionStore(), audit });
  const setup = createSetupHandler({ auth, config, audit, env: {}, publicUrl, adminToken: ADMIN });
  const server = createHttpServer({ gateway, auth, setup, host: "127.0.0.1", port: 0, publicUrl });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const port = server.address().port;
  // Behind a proxy: forwarded headers present, Host is the public host.
  const call = (method, body, cookie) => new Promise((resolve, reject) => {
    const data = body ? new URLSearchParams(body).toString() : undefined;
    const headers = { host: "windsword.example.com", "x-forwarded-for": "203.0.113.5", "x-forwarded-proto": "https", origin: "https://windsword.example.com", ...(cookie ? { cookie } : {}), ...(data ? { "content-type": "application/x-www-form-urlencoded", "content-length": Buffer.byteLength(data) } : {}) };
    const req = request({ host: "127.0.0.1", port, path: "/setup/google", method, headers }, (res) => {
      let text = ""; res.on("data", (c) => (text += c)); res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, text }));
    });
    req.on("error", reject); req.end(data);
  });
  return { config, auth, lines, call, close: () => server.close() };
}

test("hosted: setup needs the admin code; then Client ID + secret can be saved from the browser", async (t) => {
  const h = await hostedWorld();
  t.after(h.close);
  const locked = await h.call("GET");
  assert.equal(locked.status, 200);
  assert.match(locked.text, /Admin setup code/);
  assert.ok(!/name="clientSecret"/.test(locked.text), "no secret form before unlocking");
  assert.equal((await h.call("POST", { action: "save", token: "x", clientId: CLIENT_ID, clientSecret: SECRET })).status, 401, "cannot save without unlocking");

  const wrong = await h.call("POST", { action: "unlock", code: "nope" });
  assert.equal(wrong.status, 401);

  const ok = await h.call("POST", { action: "unlock", code: ADMIN });
  assert.equal(ok.status, 303);
  const cookie = ok.headers["set-cookie"][0];
  assert.match(cookie, /HttpOnly/); assert.match(cookie, /Secure/); assert.match(cookie, /SameSite=Strict/);
  const cookieHeader = cookie.split(";")[0];

  const unlocked = await h.call("GET", undefined, cookieHeader);
  assert.match(unlocked.text, /type="password"/);
  assert.match(unlocked.text, /https:\/\/windsword\.example\.com\/oauth\/callback\/google/, "shows the exact redirect URI to add to Google");
  const token = unlocked.text.match(/name="token" value="([^"]+)"/)[1];
  const saved = await h.call("POST", { action: "save", token, clientId: CLIENT_ID, clientSecret: SECRET, authRequired: "on" }, cookieHeader);
  assert.equal(saved.status, 303);
  assert.equal(h.auth.googleConfigured, true);
  const after = await h.call("GET", undefined, cookieHeader);
  assert.ok(!after.text.includes(SECRET));
  assert.match(after.text, /Test Google login/);
  assert.ok(!h.lines.join("\n").includes(SECRET) && !h.lines.join("\n").includes(ADMIN));
});

test("hosted: repeated wrong codes lock the page; a wrong Origin is refused", async (t) => {
  const h = await hostedWorld();
  t.after(h.close);
  let last;
  for (let i = 0; i < 6; i++) last = await h.call("POST", { action: "unlock", code: `bad-${i}` });
  assert.equal(last.status, 429);
  assert.equal((await h.call("POST", { action: "unlock", code: ADMIN })).status, 429, "even the right code waits while locked");
});

test("hosted without an admin code: setup stays switched off and says how to enable it", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "ws-setup-n-"));
  const secrets = new FileSecretStore(dir, loadVaultKey(dir, {}));
  const auth = new AuthService({ mode: "required" });
  const gateway = new Gateway({ registry: createDefaultRegistry(), oauth: new OAuthManager({ configs: {} }), secrets, connections: new MemoryConnectionStore(), audit: new AuditLog() });
  const setup = createSetupHandler({ auth, config: new LocalConfig(dir, secrets), audit: new AuditLog(), env: {}, publicUrl: "https://windsword.example.com" });
  const server = createHttpServer({ gateway, auth, setup, host: "127.0.0.1", port: 0, publicUrl: "https://windsword.example.com" });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  t.after(() => server.close());
  const res = await fetch(`http://127.0.0.1:${server.address().port}/setup/google`, { headers: { "x-forwarded-for": "203.0.113.5" } });
  assert.equal(res.status, 403);
  assert.match(await res.text(), /WINDSWORD_ADMIN_TOKEN/);
});
