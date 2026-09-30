import test from "node:test";
import assert from "node:assert/strict";
import { request } from "node:http";
import { mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AuditLog } from "../gateway/src/audit.ts";
import { createHash } from "node:crypto";
import { AuthService, MemorySessionStore, MemoryUserStore } from "../gateway/src/auth.ts";
import { CONNECTIONS, googleLogin } from "../gateway/src/connect/definitions.ts";
import { createConnectApi } from "../gateway/src/connect/api.ts";
import { ConnectStore } from "../gateway/src/connect/store.ts";
import { Gateway } from "../gateway/src/gateway.ts";
import { createHttpServer } from "../gateway/src/http.ts";
import { OAuthManager } from "../gateway/src/oauth.ts";
import { createDefaultRegistry } from "../gateway/src/providers/index.ts";
import { MemoryConnectionStore } from "../gateway/src/stores.ts";
import { FileSecretStore, loadVaultKey } from "../gateway/src/vault.ts";
import { jsonResponse } from "./helpers.mjs";

const SECRET = "fake-google-secret-for-tests-only-123";
const CLIENT_ID = "123456789-abcdefg.apps.googleusercontent.com";
const ADMIN = "admin-code-for-tests-only-98765";
const PUBLIC = "https://windsword.example.com";

// A second, made-up connection proves the framework is generic: no page code was written for it.
const acme = {
  id: "acme-storage", name: "Acme Storage", group: "Storage", description: "Test-only connection.",
  fields: [
    { name: "endpoint", label: "Endpoint", type: "text", secret: false, required: true },
    { name: "accessKey", label: "Access key", type: "text", secret: false, required: true },
    { name: "secretKey", label: "Secret key", type: "password", secret: true, required: true, minLength: 8 },
  ],
  test: async (values) => ({ ok: values.secretKey === "acme-secret-key-value", message: "Acme answered." }),
};

async function world({ hosted = false, adminEmails, fetch: fetchImpl } = {}) {
  const users = new MemoryUserStore();
  const sessions = new MemorySessionStore();
  const dir = mkdtempSync(join(tmpdir(), "ws-connect-"));
  const secrets = new FileSecretStore(dir, loadVaultKey(dir, {}));
  const store = new ConnectStore(dir, secrets);
  const lines = [];
  const audit = new AuditLog((l) => lines.push(l));
  const auth = new AuthService({ mode: hosted ? "required" : "off", audit, secureCookies: hosted, users, sessions });
  const gateway = new Gateway({ registry: createDefaultRegistry(), oauth: new OAuthManager({ configs: {} }), secrets, connections: new MemoryConnectionStore(), audit });
  const publicUrl = hosted ? PUBLIC : undefined;
  const connect = createConnectApi({ store, definitions: [...CONNECTIONS, acme], auth, audit, env: {}, publicUrl, fetch: fetchImpl, adminToken: hosted ? ADMIN : undefined, adminEmails });
  const server = createHttpServer({ gateway, auth, connect, host: "127.0.0.1", port: 0, publicUrl });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const port = server.address().port;
  // Hosted requests look like they come through a proxy: forwarded headers, and the public Host.
  const call = (method, path, body, { cookie, origin, csrf, headers: extra } = {}) => new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : undefined;
    const headers = {
      ...(hosted ? { host: "windsword.example.com", "x-forwarded-for": "203.0.113.5", origin: origin ?? PUBLIC } : origin ? { origin } : {}),
      ...(cookie ? { cookie } : {}),
      ...(csrf ? { "x-csrf-token": csrf } : {}),
      ...(extra ?? {}),
      ...(data ? { "content-type": "application/json", "content-length": Buffer.byteLength(data) } : {}),
    };
    const req = request({ host: "127.0.0.1", port, path, method, headers }, (res) => {
      let text = ""; res.on("data", (c) => (text += c)); res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, text, json: (() => { try { return JSON.parse(text); } catch { return undefined; } })() }));
    });
    req.on("error", reject); req.end(data);
  });
  const list = (opts) => call("GET", "/v1/admin/connections", undefined, opts);
  const csrf = async (opts) => (await list(opts)).json.csrfToken;
  const conn = (json, id) => json.connections.find((c) => c.id === id);
  const put = async (id, values, opts = {}) => call("PUT", `/v1/admin/connections/${id}`, { values }, { ...opts, csrf: opts.csrf ?? (await csrf(opts)) });
  return { dir, store, auth, users, sessions, lines, call, list, csrf, conn, put, close: () => server.close() };
}

const googleValues = (extra = {}) => ({ clientId: CLIENT_ID, clientSecret: SECRET, requireSignIn: true, ...extra });

test("the list is built from definitions: every connection, grouped, with fields; coming-soon ones can't be edited", async (t) => {
  const w = await world(); t.after(w.close);
  const r = await w.list();
  assert.equal(r.json.access, "ok");
  const names = r.json.connections.map((c) => c.name);
  for (const n of ["Google Sign-In", "Google Drive", "Dropbox", "S3 / R2", "Acme Storage"]) assert.ok(names.includes(n), n);
  const g = w.conn(r.json, "google-login");
  assert.equal(g.group, "Identity");
  assert.equal(g.status, "needs_setup");
  assert.deepEqual(g.fields.map((f) => [f.name, f.type, f.secret]), [["clientId", "text", false], ["clientSecret", "password", true], ["requireSignIn", "checkbox", false]]);
  assert.equal(w.conn(r.json, "dropbox").status, "coming_soon");
  assert.equal((await w.put("dropbox", {})).status, 400);
});

test("Google Sign-In save: secret goes to the vault only; the browser only ever gets status flags", async (t) => {
  const w = await world(); t.after(w.close);
  const res = await w.put("google-login", googleValues());
  assert.equal(res.status, 200);
  assert.equal(w.auth.googleConfigured, true);
  assert.equal(w.auth.mode, "required");

  const r = await w.list();
  const g = w.conn(r.json, "google-login");
  assert.equal(g.status, "connected");
  assert.equal(g.values.clientId, CLIENT_ID, "public value is returned");
  assert.deepEqual(g.secretsSet, { clientSecret: true }, "only a boolean for the secret");
  for (const text of [res.text, r.text]) assert.ok(!text.includes(SECRET), "no response ever contains the secret");
  assert.ok(!("clientSecret" in g.values));

  const audit = w.lines.join("\n");
  assert.match(audit, /setup\.connection_saved/);
  assert.ok(!audit.includes(SECRET) && !audit.includes(CLIENT_ID));
  for (const f of readdirSync(w.dir)) if (f !== "vault.key") assert.ok(!readFileSync(join(w.dir, f), "utf8").includes(SECRET), `${f} has no plaintext secret`);
  assert.match(readFileSync(join(w.dir, "connect.json"), "utf8"), new RegExp(CLIENT_ID), "public values live in the config file");
  const again = new ConnectStore(w.dir, new FileSecretStore(w.dir, loadVaultKey(w.dir, {})));
  assert.equal((await again.resolve(googleLogin)).clientSecret, SECRET);
});

test("Replace secret: an empty secret keeps the stored one; a first save without one is refused", async (t) => {
  const w = await world(); t.after(w.close);
  assert.equal((await w.put("google-login", googleValues({ clientSecret: "" }))).status, 400);
  await w.put("google-login", googleValues());
  assert.equal((await w.put("google-login", googleValues({ clientSecret: "", requireSignIn: false }))).status, 200);
  assert.equal((await w.store.resolve(googleLogin)).clientSecret, SECRET);
  assert.equal(w.auth.mode, "off");
  const NEW = "a-brand-new-secret-value-456";
  await w.put("google-login", googleValues({ clientSecret: NEW }));
  assert.equal((await w.store.resolve(googleLogin)).clientSecret, NEW, "explicit replace works");
});

test("bad input gets a fixed message that never reflects what was typed", async (t) => {
  const w = await world(); t.after(w.close);
  const evil = "not a secret <script>alert(1)</script>";
  const r1 = await w.put("google-login", googleValues({ clientSecret: evil }));
  assert.equal(r1.status, 400);
  assert.ok(!r1.text.includes("alert(1)") && !r1.text.includes("not a secret"));
  const r2 = await w.put("google-login", googleValues({ clientId: "nope" }));
  assert.equal(r2.status, 400);
  assert.ok(!r2.text.includes(SECRET));
  assert.equal(w.auth.googleConfigured, false);
});

test("Test Connection: invalid_grant = accepted; invalid_client = 'Connection error'; no secret in any message", async (t) => {
  let answer = { error: "invalid_grant" }; let sent;
  const fetchImpl = async (url, init) => { sent = init.body.toString(); return jsonResponse(answer, answer.error === "invalid_client" ? 401 : 400); };
  const w = await world({ fetch: fetchImpl }); t.after(w.close);
  await w.put("google-login", googleValues());
  const run = async () => w.call("POST", "/v1/admin/connections/google-login/test", {}, { csrf: await w.csrf() });
  const ok = await run();
  assert.equal(ok.json.result.ok, true);
  assert.match(ok.json.result.message, /accepted/);
  assert.ok(sent.includes("windsword-connection-test"));
  answer = { error: "invalid_client" };
  const bad = await run();
  assert.equal(bad.json.result.ok, false);
  assert.equal(w.conn(await w.list().then((r) => r.json), "google-login").status, "error");
  assert.ok(!ok.text.includes(SECRET) && !bad.text.includes(SECRET));
  assert.ok(!w.lines.join("\n").includes(SECRET));
});

test("Remove deletes the secret from the vault, clears sign-in, and audits", async (t) => {
  const w = await world(); t.after(w.close);
  await w.put("google-login", googleValues());
  const res = await w.call("DELETE", "/v1/admin/connections/google-login", undefined, { csrf: await w.csrf() });
  assert.equal(res.status, 200);
  assert.equal(res.json.connection.status, "needs_setup");
  assert.equal(await w.store.resolve(googleLogin), undefined);
  assert.equal(w.auth.googleConfigured, false);
  assert.equal(w.auth.mode, "off");
  assert.match(w.lines.join("\n"), /setup\.connection_removed/);
});

test("the same generic API works for any other definition (Acme Storage)", async (t) => {
  const w = await world(); t.after(w.close);
  const secretKey = "acme-secret-key-value";
  const res = await w.put("acme-storage", { endpoint: "https://acme.example", accessKey: "AK123", secretKey });
  assert.equal(res.status, 200);
  const c = w.conn((await w.list()).json, "acme-storage");
  assert.equal(c.values.accessKey, "AK123");
  assert.deepEqual(c.secretsSet, { secretKey: true });
  assert.ok(!res.text.includes(secretKey));
  const t1 = await w.call("POST", "/v1/admin/connections/acme-storage/test", {}, { csrf: await w.csrf() });
  assert.equal(t1.json.result.ok, true);
  assert.equal((await w.put("acme-storage", { endpoint: "", accessKey: "x", secretKey: "" })).status, 400, "required public field enforced");
});

test("state-changing calls need the CSRF token and a same-origin request", async (t) => {
  const w = await world(); t.after(w.close);
  assert.equal((await w.call("PUT", "/v1/admin/connections/google-login", { values: googleValues() })).status, 403, "no token");
  assert.equal((await w.call("PUT", "/v1/admin/connections/google-login", { values: googleValues() }, { csrf: "guess" })).status, 403, "wrong token");
  assert.equal((await w.put("google-login", googleValues(), { origin: "https://evil.example" })).status, 403, "foreign origin");
  assert.equal(w.auth.googleConfigured, false);
});

test("local-only when not hosted: proxied and foreign-Host requests get no data", async (t) => {
  const w = await world(); t.after(w.close);
  assert.equal((await w.list({ headers: { "x-forwarded-for": "203.0.113.9" } })).json.access, "disabled");
  assert.equal((await w.list({ headers: { host: "gateway.example.com" } })).json.access, "disabled", "DNS-rebinding style Host");
  assert.equal((await w.list()).json.access, "ok");
});

test("old /setup addresses redirect into Settings → Connections", async (t) => {
  const w = await world(); t.after(w.close);
  const r = await w.call("GET", "/setup/google");
  assert.equal(r.status, 302);
  assert.equal(r.headers.location, "/settings/#connections");
});

// ---- hosted: same API, behind an admin gate ----
test("hosted: nothing is revealed until the admin code is entered; then it works", async (t) => {
  const w = await world({ hosted: true }); t.after(w.close);
  const locked = await w.list();
  assert.equal(locked.json.access, "locked");
  assert.ok(!("connections" in locked.json));
  assert.equal((await w.call("PUT", "/v1/admin/connections/google-login", { values: googleValues() }, { csrf: "x" })).status, 403);
  assert.equal((await w.call("POST", "/v1/admin/unlock", { code: "nope" })).status, 401);
  assert.equal((await w.call("POST", "/v1/admin/unlock", { code: ADMIN }, { origin: "https://evil.example" })).status, 403);

  const ok = await w.call("POST", "/v1/admin/unlock", { code: ADMIN });
  assert.equal(ok.status, 200);
  const cookie = ok.headers["set-cookie"][0];
  assert.match(cookie, /HttpOnly/); assert.match(cookie, /Secure/); assert.match(cookie, /SameSite=Strict/);
  const c = { cookie: cookie.split(";")[0] };

  const list = await w.list(c);
  assert.equal(list.json.access, "ok");
  assert.match(JSON.stringify(w.conn(list.json, "google-login").advanced), /https:\/\/windsword\.example\.com\/oauth\/callback\/google/, "exact return address, under advanced");
  assert.equal((await w.put("google-login", googleValues(), c)).status, 200);
  assert.equal(w.auth.googleConfigured, true);
  assert.ok(!(await w.list(c)).text.includes(SECRET));
  assert.ok(!w.lines.join("\n").includes(ADMIN) && !w.lines.join("\n").includes(SECRET));
});

test("hosted: five wrong codes lock the gate, even for the right code", async (t) => {
  const w = await world({ hosted: true }); t.after(w.close);
  let last;
  for (let i = 0; i < 6; i++) last = await w.call("POST", "/v1/admin/unlock", { code: `bad-${i}` });
  assert.equal(last.status, 429);
  assert.equal((await w.call("POST", "/v1/admin/unlock", { code: ADMIN })).status, 429);
});

test("hosted: a signed-in Google account listed in WINDSWORD_ADMIN_EMAILS is an admin; other users are not", async (t) => {
  const w = await world({ hosted: true, adminEmails: ["boss@example.com"] }); t.after(w.close);
  const sessionFor = async (email) => {
    const user = await w.users.upsertFromIdentity({ sub: `sub-${email}`, email, name: email });
    const id = `session-id-${email}-0123456789abcdef`;
    await w.sessions.put(createHash("sha256").update(id).digest("hex"), { userId: user.id, csrf: "c", createdAt: Date.now(), expiresAt: Date.now() + 3_600_000 });
    return { cookie: `__Host-windsword_session=${id}` };
  };
  assert.equal((await w.list()).json.access, "locked");
  assert.equal((await w.list(await sessionFor("someone@example.com"))).json.access, "locked");
  assert.equal((await w.list(await sessionFor("boss@example.com"))).json.access, "ok");
});

test("hosted without any admin credential: disabled, with a plain explanation", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "ws-connect-n-"));
  const secrets = new FileSecretStore(dir, loadVaultKey(dir, {}));
  const auth = new AuthService({ mode: "required" });
  const gateway = new Gateway({ registry: createDefaultRegistry(), oauth: new OAuthManager({ configs: {} }), secrets, connections: new MemoryConnectionStore(), audit: new AuditLog() });
  const connect = createConnectApi({ store: new ConnectStore(dir, secrets), definitions: CONNECTIONS, auth, audit: new AuditLog(), env: {}, publicUrl: PUBLIC });
  const server = createHttpServer({ gateway, auth, connect, host: "127.0.0.1", port: 0, publicUrl: PUBLIC });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  t.after(() => server.close());
  const res = await fetch(`http://127.0.0.1:${server.address().port}/v1/admin/connections`, { headers: { "x-forwarded-for": "203.0.113.5" } });
  const json = await res.json();
  assert.equal(json.access, "disabled");
  assert.match(json.message, /WINDSWORD_ADMIN_TOKEN/);
});
