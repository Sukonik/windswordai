import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer, request } from "node:http";
import { mkdtempSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CachedStateIO, StorageError, SupabaseBackend } from "../gateway/src/state.ts";
import { ConnectStore } from "../gateway/src/connect/store.ts";
import { googleLogin } from "../gateway/src/connect/definitions.ts";
import { FileSecretStore } from "../gateway/src/vault.ts";
import { FileSessionStore, FileUserStore } from "../gateway/src/auth.ts";
import { jsonResponse } from "./helpers.mjs";

const KEY = "sb_secret_test_key_not_real";
const SECRET = "fake-google-secret-for-tests-only-123";
const CLIENT_ID = "123456789-abcdefg.apps.googleusercontent.com";
const VAULT_KEY = Buffer.alloc(32, 7);

/** An in-memory stand-in for the Supabase REST API. */
function fakeSupabase({ failWrites = 0, badKey = false } = {}) {
  const rows = new Map();
  const calls = [];
  let failures = failWrites;
  const fetchImpl = async (url, init = {}) => {
    const u = new URL(url);
    calls.push({ method: init.method ?? "GET", path: u.pathname, search: u.search, headers: init.headers ?? {}, body: init.body });
    if (badKey) return jsonResponse({}, 401);
    if (u.pathname !== "/rest/v1/windsword_state") return jsonResponse({}, 404);
    if ((init.method ?? "GET") === "GET") return jsonResponse([...rows].map(([name, value]) => ({ name, value })));
    if (failures > 0) { failures--; return jsonResponse({}, 503); }
    const row = JSON.parse(init.body);
    rows.set(row.name, row.value);
    return jsonResponse({}, 201);
  };
  return { rows, calls, fetchImpl };
}
const backendFor = (fake) => new SupabaseBackend({ url: "https://proj.supabase.co/", key: KEY, fetch: fake.fetchImpl, retryDelayMs: 1 });

test("Supabase backend: reads and upserts through the REST API with the secret key, sent as apikey only for new-style keys", async () => {
  const fake = fakeSupabase();
  const b = backendFor(fake);
  await b.save("vault", { a: 1 });
  await b.save("vault", { a: 2 });
  assert.deepEqual(await b.loadAll(), { vault: { a: 2 } });
  const post = fake.calls.find((c) => c.method === "POST");
  assert.equal(post.path, "/rest/v1/windsword_state");
  assert.equal(post.headers.apikey, KEY);
  assert.equal(post.headers.authorization, undefined, "sb_secret_ keys are not sent as bearer tokens");
  assert.match(post.headers.prefer, /merge-duplicates/);
  const jwt = new SupabaseBackend({ url: "https://p.supabase.co", key: "eyJhbGciOi.payload.sig", fetch: fake.fetchImpl });
  await jwt.save("x", {});
  assert.equal(fake.calls.at(-1).headers.authorization, "Bearer eyJhbGciOi.payload.sig", "legacy JWT keys also go as bearer");
});

test("Supabase backend: retries transient failures, gives up on client errors, and errors never contain the key", async () => {
  const flaky = fakeSupabase({ failWrites: 2 });
  await backendFor(flaky).save("vault", { ok: true });
  assert.deepEqual(flaky.rows.get("vault"), { ok: true });
  const down = fakeSupabase({ failWrites: 99 });
  await assert.rejects(backendFor(down).save("vault", {}), (e) => e instanceof StorageError && !e.message.includes(KEY));
  await assert.rejects(backendFor(fakeSupabase({ badKey: true })).loadAll(), (e) => e instanceof StorageError && /HTTP 401/.test(e.message) && !e.message.includes(KEY));
  const missing = new SupabaseBackend({ url: "https://p.supabase.co", key: KEY, fetch: async () => jsonResponse({}, 404) });
  await assert.rejects(missing.loadAll(), /table does not exist/);
});

test("a failed write changes nothing: the in-memory copy is rolled back", async () => {
  const fake = fakeSupabase();
  const io = await CachedStateIO.open(backendFor(fake));
  await io.write("doc", { v: 1 });
  const broken = fakeSupabase({ failWrites: 99 });
  const io2 = await CachedStateIO.open(backendFor(broken));
  await assert.rejects(io2.write("doc", { v: 2 }));
  assert.equal(io2.read("doc", "missing"), "missing");
  assert.deepEqual(io.read("doc", null), { v: 1 });
});

test("Google Sign-In survives a restart on a wiped disk: the secret comes back from Supabase, decrypted with the env key, and is never stored in plain text", async () => {
  const fake = fakeSupabase();
  const io = await CachedStateIO.open(backendFor(fake));
  const store = new ConnectStore(io, new FileSecretStore(io, VAULT_KEY));
  await store.save(googleLogin, { clientId: CLIENT_ID, clientSecret: SECRET, requireSignIn: "on" });
  await new FileUserStore(io).upsertFromIdentity({ sub: "s", email: "a@example.com" });
  await new FileSessionStore(io).put("hash", { userId: "u", csrf: "c", createdAt: Date.now(), expiresAt: Date.now() + 1e6 });

  assert.ok(!JSON.stringify([...fake.rows]).includes(SECRET), "database rows hold no plaintext secret");
  assert.ok([...fake.rows.keys()].every((k) => ["vault", "connect", "users", "sessions"].includes(k)));

  // "Restart": brand-new process state, only Supabase and the env key survive.
  const io2 = await CachedStateIO.open(backendFor(fake));
  const store2 = new ConnectStore(io2, new FileSecretStore(io2, VAULT_KEY));
  const values = await store2.resolve(googleLogin);
  assert.equal(values.clientSecret, SECRET);
  assert.equal(values.requireSignIn, true);
  assert.ok(await new FileSessionStore(io2).get("hash"), "sessions survive too, so people stay signed in after the service wakes");
  // Wrong vault key (e.g. someone changed the env var): secrets are unreadable rather than wrong.
  const io3 = await CachedStateIO.open(backendFor(fake));
  assert.equal(await new ConnectStore(io3, new FileSecretStore(io3, Buffer.alloc(32, 9))).resolve(googleLogin), undefined);
});

// ---- the real server process, on a disk that is wiped between runs ----
function startFakeSupabaseServer() {
  const rows = new Map();
  const server = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      if (req.headers.apikey !== KEY) { res.writeHead(401).end("{}"); return; }
      if (req.method === "GET") { res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify([...rows].map(([name, value]) => ({ name, value })))); return; }
      const row = JSON.parse(body); rows.set(row.name, row.value); res.writeHead(201).end();
    });
  });
  return new Promise((r) => server.listen(0, "127.0.0.1", () => r({ server, rows, url: `http://127.0.0.1:${server.address().port}` })));
}

async function boot(env) {
  const child = spawn("node", ["gateway/server.ts"], { env: { ...process.env, ...env }, stdio: ["ignore", "pipe", "pipe"] });
  let log = "";
  child.stdout.on("data", (d) => (log += d)); child.stderr.on("data", (d) => (log += d));
  const exited = new Promise((r) => child.once("exit", (code) => r(code)));
  for (let i = 0; i < 80; i++) {
    try { if ((await fetch(`http://127.0.0.1:${env.WINDSWORD_PORT}/v1/health`)).ok) break; } catch { /* starting */ }
    if (child.exitCode !== null) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  return { child, exited, get log() { return log; }, stop: async () => { child.kill(); await exited; } };
}

const adminCall = (port, method, path, body, csrf) => new Promise((resolve, reject) => {
  const data = body ? JSON.stringify(body) : undefined;
  const req = request({ host: "127.0.0.1", port, path, method, headers: { ...(csrf ? { "x-csrf-token": csrf } : {}), ...(data ? { "content-type": "application/json", "content-length": Buffer.byteLength(data) } : {}) } }, (res) => {
    let t = ""; res.on("data", (c) => (t += c)); res.on("end", () => resolve({ status: res.statusCode, json: JSON.parse(t || "{}"), text: t }));
  });
  req.on("error", reject); req.end(data);
});

test("server on Supabase: setup persists across restarts even when the local disk is wiped (Render Free)", async (t) => {
  const sb = await startFakeSupabaseServer();
  t.after(() => sb.server.close());
  const port = 8791;
  const envFor = () => ({ WINDSWORD_PORT: String(port), WINDSWORD_STATE_DIR: mkdtempSync(join(tmpdir(), "ws-wiped-")), SUPABASE_URL: sb.url, SUPABASE_SERVICE_ROLE_KEY: KEY, WINDSWORD_VAULT_KEY: VAULT_KEY.toString("base64"), WINDSWORD_AUTH: "", WINDSWORD_GOOGLE_CLIENT_ID: "", WINDSWORD_GOOGLE_CLIENT_SECRET: "" });

  const env1 = envFor();
  const g1 = await boot(env1);
  t.after(() => g1.child.kill());
  assert.match(g1.log, /storage\s*: Supabase/);
  assert.equal((await (await fetch(`http://127.0.0.1:${port}/v1/health`)).json()).storage, "supabase");
  const list = await adminCall(port, "GET", "/v1/admin/connections");
  const saved = await adminCall(port, "PUT", "/v1/admin/connections/google-login", { values: { clientId: CLIENT_ID, clientSecret: SECRET, requireSignIn: true } }, list.json.csrfToken);
  assert.equal(saved.status, 200);
  await g1.stop();
  assert.ok(!JSON.stringify([...sb.rows]).includes(SECRET), "Supabase never sees the plain secret");
  assert.deepEqual(readdirSync(env1.WINDSWORD_STATE_DIR).filter((f) => f.endsWith(".json")), [], "nothing important is written to the local disk");

  const g2 = await boot(envFor()); // different, empty state dir = wiped disk
  t.after(() => g2.child.kill());
  assert.match(g2.log, /sign-in\s*: Google REQUIRED/);
  assert.match(g2.log, /secret set: yes/);
  assert.ok(!g2.log.includes(SECRET) && !g2.log.includes(KEY) && !g2.log.includes(VAULT_KEY.toString("base64")), "logs contain no secrets");
  const after = await adminCall(port, "GET", "/v1/admin/connections");
  const google = after.json.connections.find((c) => c.id === "google-login");
  assert.equal(google.status, "connected");
  assert.deepEqual(google.secretsSet, { clientSecret: true });
  assert.ok(!after.text.includes(SECRET));
  await g2.stop();
});

test("server refuses to start on Supabase without a stable vault key, or if Supabase can't be read", async (t) => {
  const sb = await startFakeSupabaseServer();
  t.after(() => sb.server.close());
  const base = { WINDSWORD_PORT: "8790", WINDSWORD_STATE_DIR: mkdtempSync(join(tmpdir(), "ws-guard-")), SUPABASE_URL: sb.url, SUPABASE_SERVICE_ROLE_KEY: KEY, WINDSWORD_VAULT_KEY: "" };
  const noKey = await boot(base);
  assert.notEqual(await noKey.exited, 0);
  assert.match(noKey.log, /needs WINDSWORD_VAULT_KEY/);
  const badKey = await boot({ ...base, WINDSWORD_VAULT_KEY: VAULT_KEY.toString("base64"), SUPABASE_SERVICE_ROLE_KEY: "wrong-key" });
  assert.notEqual(await badKey.exited, 0);
  assert.match(badKey.log, /refused the request \(HTTP 401\)/);
  assert.ok(!badKey.log.includes("wrong-key"));
});
