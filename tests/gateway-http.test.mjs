import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Gateway } from "../gateway/src/gateway.ts";
import { createHttpServer } from "../gateway/src/http.ts";
import { createDefaultRegistry } from "../gateway/src/providers/index.ts";
import { fakeFetch, jsonResponse, sseResponse } from "./helpers.mjs";

const SECRET = "sk-http-SECRET-987654321";
const TOKEN = "tok-abc";
let server, base, gateway, upstream;

before(async () => {
  upstream = fakeFetch([
    [(u) => u.endsWith("/v1/models?limit=100"), () => jsonResponse({ data: [{ id: "claude-x" }] })],
    [(u) => u.endsWith("/v1/messages"), () => sseResponse([
      { data: { type: "content_block_delta", delta: { type: "text_delta", text: "ok" } } },
      { data: { type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 1 } } },
    ])],
  ]);
  gateway = new Gateway({ registry: createDefaultRegistry({ mockDelayMs: 0 }), fetch: upstream });
  const dir = mkdtempSync(join(tmpdir(), "ws-static-"));
  mkdirSync(join(dir, "chat"));
  writeFileSync(join(dir, "index.html"), "<h1>home</h1>");
  writeFileSync(join(dir, "chat", "index.html"), "<h1>chat</h1>");
  server = createHttpServer({ gateway, token: TOKEN, allowedOrigins: ["http://localhost:3000"], staticDir: dir });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());

const auth = { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" };
async function sse(path, body) {
  const res = await fetch(base + path, { method: "POST", headers: auth, body: JSON.stringify(body) });
  const text = await res.text();
  return { res, events: text.split("\n\n").filter(Boolean).map((b) => JSON.parse(b.replace(/^data: /, ""))) };
}

test("health is open, everything else needs the token", async () => {
  assert.equal((await fetch(`${base}/v1/health`)).status, 200);
  assert.equal((await fetch(`${base}/v1/providers`)).status, 401);
  assert.equal((await fetch(`${base}/v1/providers`, { headers: { authorization: "Bearer wrong" } })).status, 401);
  assert.equal((await fetch(`${base}/v1/providers`, { headers: auth })).status, 200);
});

test("refuses to bind beyond loopback without a token", () => {
  assert.throws(() => createHttpServer({ gateway, host: "0.0.0.0" }), /token is required/);
});

test("providers endpoint lists product priority order and never exposes secrets", async () => {
  const res = await fetch(`${base}/v1/providers?mode=secure_local`, { headers: auth });
  const json = await res.json();
  assert.deepEqual(json.providers.slice(0, 5).map((p) => p.descriptor.id), ["claude", "openai", "meta", "gemini", "mistral"]);
  assert.equal(json.providers.find((p) => p.descriptor.id === "claude").eligibility.code, "secure_local_blocks_cloud");
  assert.ok(!JSON.stringify(json).includes("secretRef"));
});

test("chat streams SSE through the gateway (mock, secure local)", async () => {
  const { res, events } = await sse("/v1/chat", { providerId: "mock", model: "mock-legal", mode: "secure_local", contentClass: "synthetic", messages: [{ role: "user", content: "hello" }] });
  assert.match(res.headers.get("content-type"), /text\/event-stream/);
  assert.equal(events[0].type, "start");
  assert.ok(events.some((e) => e.type === "delta"));
  assert.equal(events.at(-1).type, "done");
});

test("connect a Claude key over HTTP, then stream in standard mode; blocked in secure local", async () => {
  const c = await fetch(`${base}/v1/connections/claude`, { method: "POST", headers: auth, body: JSON.stringify({ type: "api_key", apiKey: SECRET }) });
  assert.equal(c.status, 200);
  const body = await c.text();
  assert.ok(!body.includes(SECRET), "API response must not echo the key");

  const ok = await sse("/v1/chat", { providerId: "claude", model: "claude-x", mode: "standard", contentClass: "general", messages: [{ role: "user", content: "hi" }] });
  assert.equal(ok.events.filter((e) => e.type === "delta").map((e) => e.text).join(""), "ok");

  const blocked = await sse("/v1/chat", { providerId: "claude", model: "claude-x", mode: "secure_local", contentClass: "general", messages: [{ role: "user", content: "hi" }] });
  assert.equal(blocked.events[0].type, "blocked");

  const prot = await sse("/v1/chat", { providerId: "claude", model: "claude-x", mode: "standard", contentClass: "protected", messages: [{ role: "user", content: "hi" }] });
  assert.equal(prot.events[0].code, "protected_content_blocks_cloud");
});

test("bad JSON and missing fields return 400 with typed errors", async () => {
  const bad = await fetch(`${base}/v1/chat`, { method: "POST", headers: auth, body: "{nope" });
  assert.equal(bad.status, 400);
  const missing = await fetch(`${base}/v1/chat`, { method: "POST", headers: auth, body: JSON.stringify({}) });
  assert.equal(missing.status, 400);
  assert.equal((await missing.json()).error.code, "bad_request");
});

test("compare: two independent streams, each with its own policy decision", async () => {
  const req = { mode: "standard", contentClass: "general", attachmentCount: 1, messages: [{ role: "user", content: "compare" }], compareGroupId: "cmp_1" };
  const [a, b] = await Promise.all([
    sse("/v1/chat", { ...req, providerId: "claude", model: "claude-x" }),
    sse("/v1/chat", { ...req, providerId: "mock", model: "mock-legal" }),
  ]);
  assert.equal(a.events[0].type, "blocked", "cloud side blocked because a document is attached");
  assert.equal(b.events.at(-1).type, "done", "local side still runs");
  const pre = await (await fetch(`${base}/v1/preflight`, { method: "POST", headers: auth, body: JSON.stringify({ mode: "standard", attachmentCount: 1, providers: ["claude", "mock"] }) })).json();
  assert.equal(pre.decisions.claude.allow, false);
  assert.equal(pre.decisions.mock.allow, true);
});

test("disconnect removes the connection", async () => {
  const d = await fetch(`${base}/v1/connections/claude`, { method: "DELETE", headers: auth });
  assert.equal(d.status, 200);
  const after = await sse("/v1/chat", { providerId: "claude", model: "claude-x", mode: "standard", contentClass: "general", messages: [{ role: "user", content: "hi" }] });
  assert.equal(after.events[0].code, "not_connected");
});

test("audit endpoint returns metadata only", async () => {
  const json = await (await fetch(`${base}/v1/audit?limit=200`, { headers: auth })).json();
  const dump = JSON.stringify(json);
  assert.ok(json.events.length > 5);
  assert.ok(!dump.includes(SECRET));
  assert.ok(!dump.includes('"hello"') && !dump.includes("compare\""), "no prompt text in audit");
});

test("CORS only for allowed origins", async () => {
  const ok = await fetch(`${base}/v1/health`, { headers: { origin: "http://localhost:3000" } });
  assert.equal(ok.headers.get("access-control-allow-origin"), "http://localhost:3000");
  const no = await fetch(`${base}/v1/health`, { headers: { origin: "https://evil.example" } });
  assert.equal(no.headers.get("access-control-allow-origin"), null);
});

test("static UI is served and path traversal is refused", async () => {
  assert.match(await (await fetch(`${base}/`)).text(), /home/);
  assert.match(await (await fetch(`${base}/chat/`)).text(), /chat/);
  const trav = await fetch(`${base}/%2e%2e/%2e%2e/etc/passwd`);
  assert.ok([403, 404].includes(trav.status));
  assert.ok(!(await trav.text()).includes("root:"));
});
