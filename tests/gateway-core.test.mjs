import test from "node:test";
import assert from "node:assert/strict";
import { Gateway } from "../gateway/src/gateway.ts";
import { AuditLog } from "../gateway/src/audit.ts";
import { createDefaultRegistry } from "../gateway/src/providers/index.ts";
import { MemoryConnectionStore, MemorySecretStore } from "../gateway/src/stores.ts";
import { sseEvents, ndjson } from "../gateway/src/stream.ts";
import { collect, fakeFetch, jsonResponse, sseResponse, streamBody } from "./helpers.mjs";

const SECRET = "sk-test-SECRET-0123456789";
const PROMPT = "CONFIDENTIAL: settlement figure is $4.2M for Acme";

function makeGateway(fetchImpl, extra = {}) {
  const lines = [];
  const audit = new AuditLog((l) => lines.push(l));
  const secrets = new MemorySecretStore();
  const gw = new Gateway({ registry: createDefaultRegistry({ mockDelayMs: 0 }), fetch: fetchImpl, audit, secrets, connections: new MemoryConnectionStore(), ...extra });
  return { gw, audit, lines, secrets };
}

const anthropicRoutes = [
  [(u) => u.endsWith("/v1/models?limit=100"), () => jsonResponse({ data: [{ id: "claude-x", display_name: "Claude X" }] })],
  [
    (u) => u.endsWith("/v1/messages"),
    () =>
      sseResponse([
        { event: "message_start", data: { type: "message_start", message: { usage: { input_tokens: 11 } } } },
        { event: "content_block_delta", data: { type: "content_block_delta", delta: { type: "text_delta", text: "Hello " } } },
        { event: "content_block_delta", data: { type: "content_block_delta", delta: { type: "text_delta", text: "counsel" } } },
        { event: "message_delta", data: { type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 5 } } },
        { event: "message_stop", data: { type: "message_stop" } },
      ]),
  ],
];

test("SSE parser handles events split across arbitrary chunk boundaries", async () => {
  const body = streamBody("event: a\ndata: {\"x\":1}\n\ndata: two\ndata: lines\n\n", 3);
  const events = await collect(sseEvents(body));
  assert.deepEqual(events, [{ event: "a", data: '{"x":1}' }, { event: undefined, data: "two\nlines" }]);
});

test("ndjson parser handles split lines", async () => {
  const items = await collect(ndjson(streamBody('{"a":1}\n{"a":2}\n', 4)));
  assert.deepEqual(items, [{ a: 1 }, { a: 2 }]);
});

test("mock provider streams through the gateway with no credentials (secure local)", async () => {
  const { gw } = makeGateway(fakeFetch([]));
  const events = await collect(gw.chat({ providerId: "mock", model: "mock-legal", mode: "secure_local", contentClass: "synthetic", messages: [{ role: "user", content: "Review this clause" }] }));
  assert.equal(events[0].type, "start");
  assert.ok(events.filter((e) => e.type === "delta").length > 5);
  assert.equal(events.at(-1).type, "done");
});

test("secure local mode blocks cloud providers even when connected", async () => {
  const f = fakeFetch(anthropicRoutes);
  const { gw } = makeGateway(f);
  await gw.connect("claude", { type: "api_key", apiKey: SECRET });
  const events = await collect(gw.chat({ providerId: "claude", model: "claude-x", mode: "secure_local", contentClass: "general", messages: [{ role: "user", content: "hi" }] }));
  assert.equal(events.length, 1);
  assert.equal(events[0].type, "blocked");
  assert.equal(events[0].code, "secure_local_blocks_cloud");
  assert.equal(f.calls.filter((c) => c.url.endsWith("/v1/messages")).length, 0, "no vendor request may be made when blocked");
});

test("connect validates the key by probing live models, then chat streams Anthropic events", async () => {
  const f = fakeFetch(anthropicRoutes);
  const { gw } = makeGateway(f);
  const view = await gw.connect("claude", { type: "api_key", apiKey: SECRET });
  assert.equal(view.status, "ready");
  assert.deepEqual(view.models.map((m) => m.id), ["claude-x"]);
  assert.equal(view.connection.secretRef, undefined, "secret reference must not be exposed in views");

  const events = await collect(gw.chat({ providerId: "claude", model: "claude-x", mode: "standard", contentClass: "general", messages: [{ role: "system", content: "Be brief." }, { role: "user", content: "hi" }] }));
  assert.equal(events.filter((e) => e.type === "delta").map((e) => e.text).join(""), "Hello counsel");
  const usage = events.find((e) => e.type === "usage");
  assert.deepEqual([usage.inputTokens, usage.outputTokens], [11, 5]);

  const call = f.calls.find((c) => c.url.endsWith("/v1/messages"));
  assert.equal(call.init.headers["x-api-key"], SECRET);
  const body = JSON.parse(call.init.body);
  assert.equal(body.system, "Be brief.");
  assert.deepEqual(body.messages, [{ role: "user", content: "hi" }]);
});

test("protected content is never sent to a cloud provider (no vendor request made)", async () => {
  const f = fakeFetch(anthropicRoutes);
  const { gw } = makeGateway(f);
  await gw.connect("claude", { type: "api_key", apiKey: SECRET });
  const events = await collect(gw.chat({ providerId: "claude", model: "claude-x", mode: "standard", contentClass: "protected", messages: [{ role: "user", content: PROMPT }] }));
  assert.equal(events[0].type, "blocked");
  assert.equal(events[0].code, "protected_content_blocks_cloud");
  assert.equal(f.calls.filter((c) => c.url.endsWith("/v1/messages")).length, 0);
});

test("bad credentials are rejected at connect time and nothing is stored", async () => {
  const f = fakeFetch([[() => true, () => jsonResponse({ error: "no" }, 401)]]);
  const { gw, secrets } = makeGateway(f);
  await assert.rejects(() => gw.connect("claude", { type: "api_key", apiKey: SECRET }), (e) => e.code === "auth_failed" && !e.message.includes(SECRET));
  const view = (await gw.listProviders("standard")).find((v) => v.descriptor.id === "claude");
  assert.equal(view.status, "not_connected");
  assert.equal(await secrets.get("anything"), undefined);
});

test("subscription-linked Claude is honestly reported as planned and cannot be connected", async () => {
  const { gw } = makeGateway(fakeFetch([]));
  await assert.rejects(() => gw.connect("claude", { type: "subscription" }), /planned/);
  await assert.rejects(() => gw.connect("openai", { type: "subscription" }), /unsupported/);
});

test("provider failures degrade to a typed, retryable error event", async () => {
  const f = fakeFetch([
    ...anthropicRoutes.slice(0, 1),
    [(u) => u.endsWith("/v1/messages"), () => new Response("overloaded", { status: 529 })],
  ]);
  const { gw } = makeGateway(f);
  await gw.connect("claude", { type: "api_key", apiKey: SECRET });
  const events = await collect(gw.chat({ providerId: "claude", model: "claude-x", mode: "standard", contentClass: "general", messages: [{ role: "user", content: "hi" }] }));
  const err = events.at(-1);
  assert.equal(err.type, "error");
  assert.equal(err.code, "provider_unavailable");
  assert.equal(err.retryable, true);
});

test("mock failure keyword produces a graceful error", async () => {
  const { gw } = makeGateway(fakeFetch([]));
  const events = await collect(gw.chat({ providerId: "mock", model: "mock-legal", mode: "secure_local", contentClass: "synthetic", messages: [{ role: "user", content: "please [fail]" }] }));
  assert.equal(events.at(-1).type, "error");
  assert.equal(events.at(-1).retryable, true);
});

test("cancellation stops a stream and reports cancelled", async () => {
  const { gw } = makeGateway(fakeFetch([]), {});
  const gw2 = new Gateway({ registry: createDefaultRegistry({ mockDelayMs: 15 }) });
  const ctrl = new AbortController();
  const out = [];
  for await (const e of gw2.chat({ providerId: "mock", model: "mock-legal", mode: "secure_local", contentClass: "synthetic", messages: [{ role: "user", content: "long answer" }] }, ctrl.signal)) {
    out.push(e);
    if (out.length === 4) ctrl.abort();
  }
  assert.equal(out.at(-1).type, "error");
  assert.equal(out.at(-1).code, "cancelled");
  void gw;
});

test("OpenAI-compatible adapter (OpenAI / Mistral / Meta) streams and reports usage", async () => {
  const f = fakeFetch([
    [(u) => u.endsWith("/models"), () => jsonResponse({ data: [{ id: "m-b" }, { id: "m-a" }] })],
    [
      (u) => u.endsWith("/chat/completions"),
      () =>
        sseResponse([
          { data: { choices: [{ delta: { content: "Par" } }] } },
          { data: { choices: [{ delta: { content: "ty" }, finish_reason: "stop" }] } },
          { data: { choices: [], usage: { prompt_tokens: 3, completion_tokens: 2 } } },
          { data: "[DONE]" },
        ]),
    ],
  ]);
  const { gw } = makeGateway(f);
  await assert.rejects(() => gw.connect("meta", { type: "api_key", apiKey: SECRET }), /base URL/);
  for (const id of ["openai", "mistral", "meta"]) {
    const view = await gw.connect(id, { type: "api_key", apiKey: SECRET, baseUrl: id === "meta" ? "https://meta.example/v1" : undefined });
    assert.deepEqual(view.models.map((m) => m.id), ["m-a", "m-b"]);
    const events = await collect(gw.chat({ providerId: id, model: "m-a", mode: "standard", contentClass: "general", messages: [{ role: "user", content: "x" }] }));
    assert.equal(events.filter((e) => e.type === "delta").map((e) => e.text).join(""), "Party");
    assert.deepEqual(events.find((e) => e.type === "usage").outputTokens, 2);
  }
  const urls = f.calls.map((c) => c.url);
  assert.ok(urls.some((u) => u.startsWith("https://api.openai.com/v1/")));
  assert.ok(urls.some((u) => u.startsWith("https://api.mistral.ai/v1/")));
  assert.ok(urls.some((u) => u.startsWith("https://meta.example/v1/")));
});

test("Gemini adapter maps roles, streams SSE and lists generateContent models", async () => {
  const f = fakeFetch([
    [(u) => u.includes("/v1beta/models?"), () => jsonResponse({ models: [{ name: "models/gem-1", displayName: "Gem 1", supportedGenerationMethods: ["generateContent"] }, { name: "models/emb", supportedGenerationMethods: ["embedContent"] }] })],
    [
      (u) => u.includes(":streamGenerateContent"),
      () =>
        sseResponse([
          { data: { candidates: [{ content: { parts: [{ text: "Al" }] } }] } },
          { data: { candidates: [{ content: { parts: [{ text: "pha" }] }, finishReason: "STOP" }], usageMetadata: { promptTokenCount: 4, candidatesTokenCount: 2 } } },
        ]),
    ],
  ]);
  const { gw } = makeGateway(f);
  const view = await gw.connect("gemini", { type: "api_key", apiKey: SECRET });
  assert.deepEqual(view.models.map((m) => m.id), ["gem-1"]);
  const events = await collect(gw.chat({ providerId: "gemini", model: "gem-1", mode: "standard", contentClass: "general", messages: [{ role: "system", content: "S" }, { role: "user", content: "u" }, { role: "assistant", content: "a" }, { role: "user", content: "u2" }] }));
  assert.equal(events.filter((e) => e.type === "delta").map((e) => e.text).join(""), "Alpha");
  const body = JSON.parse(f.calls.find((c) => c.url.includes(":streamGenerateContent")).init.body);
  assert.deepEqual(body.contents.map((c) => c.role), ["user", "model", "user"]);
  assert.equal(body.systemInstruction.parts[0].text, "S");
  assert.equal(f.calls.find((c) => c.url.includes(":streamGenerateContent")).init.headers["x-goog-api-key"], SECRET);
});

test("Ollama adapter streams NDJSON with no account and is allowed in secure local", async () => {
  const f = fakeFetch([
    [(u) => u.endsWith("/api/tags"), () => jsonResponse({ models: [{ name: "llama-x" }] })],
    [
      (u) => u.endsWith("/api/chat"),
      () => new Response(streamBody('{"message":{"content":"lo"},"done":false}\n{"message":{"content":"cal"},"done":false}\n{"done":true,"done_reason":"stop","prompt_eval_count":2,"eval_count":2}\n', 9)),
    ],
  ]);
  const { gw } = makeGateway(f);
  const events = await collect(gw.chat({ providerId: "ollama", model: "llama-x", mode: "secure_local", contentClass: "protected", attachmentCount: 2, messages: [{ role: "user", content: PROMPT }] }));
  assert.equal(events.filter((e) => e.type === "delta").map((e) => e.text).join(""), "local");
  assert.equal(events.at(-1).type, "done");
});

test("audit log and error text never contain prompts or credentials", async () => {
  const f = fakeFetch([...anthropicRoutes.slice(0, 1), [(u) => u.endsWith("/v1/messages"), () => new Response(`bad key ${SECRET}`, { status: 401 })]]);
  const { gw, audit, lines } = makeGateway(f);
  await gw.connect("claude", { type: "api_key", apiKey: SECRET });
  const events = await collect(gw.chat({ providerId: "claude", model: "claude-x", mode: "standard", contentClass: "general", messages: [{ role: "user", content: PROMPT }] }));
  await collect(gw.chat({ providerId: "mock", model: "mock-legal", mode: "secure_local", contentClass: "synthetic", messages: [{ role: "user", content: PROMPT }] }));
  const dump = JSON.stringify(audit.recent(100)) + lines.join("\n") + JSON.stringify(events);
  assert.ok(!dump.includes(SECRET), "secret leaked");
  assert.ok(!dump.includes("CONFIDENTIAL"), "prompt content leaked");
  assert.ok(!dump.includes("4.2M"), "prompt content leaked");
  const chatEvents = audit.recent(100).filter((e) => e.type.startsWith("chat."));
  assert.ok(chatEvents.every((e) => typeof e.counts?.promptChars === "number"));
});

test("disconnect deletes stored credential material", async () => {
  const f = fakeFetch(anthropicRoutes);
  const secrets = new MemorySecretStore();
  const connections = new MemoryConnectionStore();
  const gw = new Gateway({ registry: createDefaultRegistry(), fetch: f, secrets, connections });
  await gw.connect("claude", { type: "api_key", apiKey: SECRET });
  const ref = (await connections.get("claude")).secretRef;
  assert.equal(await secrets.get(ref), SECRET);
  await gw.disconnect("claude");
  assert.equal(await secrets.get(ref), undefined);
  assert.equal(await connections.get("claude"), undefined);
});

test("registry: a new provider is descriptor + adapter, re-orderable and disable-able without touching chat", async () => {
  const registry = createDefaultRegistry({ mockDelayMs: 0 });
  const mock = registry.get("mock");
  registry.register({ ...mock, descriptor: { ...mock.descriptor, id: "future-ai", displayName: "FutureAI", order: 5 } });
  assert.equal(registry.list()[0].descriptor.id, "future-ai");
  registry.setOrder("future-ai", 500);
  assert.equal(registry.list().at(-1).descriptor.id, "future-ai");
  registry.setEnabled("future-ai", false);
  const gw = new Gateway({ registry });
  const events = await collect(gw.chat({ providerId: "future-ai", model: "mock-legal", mode: "secure_local", contentClass: "synthetic", messages: [{ role: "user", content: "x" }] }));
  assert.equal(events[0].code, "provider_disabled");
  assert.deepEqual(registry.list().slice(0, 5).map((a) => a.descriptor.id), ["claude", "openai", "meta", "gemini", "mistral"]);
});

test("provider views report eligibility per mode with reasons (Secure Local visibly disables cloud)", async () => {
  const { gw } = makeGateway(fakeFetch(anthropicRoutes));
  await gw.connect("claude", { type: "api_key", apiKey: SECRET });
  const local = await gw.listProviders("secure_local");
  const standard = await gw.listProviders("standard");
  assert.equal(local.find((v) => v.descriptor.id === "claude").eligibility.code, "secure_local_blocks_cloud");
  assert.equal(standard.find((v) => v.descriptor.id === "claude").eligibility.allow, true);
  assert.equal(standard.find((v) => v.descriptor.id === "claude").protectedEligibility.allow, false);
  assert.equal(local.find((v) => v.descriptor.id === "mock").eligibility.allow, true);
});

test("compare preflight decides each provider independently", async () => {
  const { gw } = makeGateway(fakeFetch(anthropicRoutes));
  await gw.connect("claude", { type: "api_key", apiKey: SECRET });
  const d = await gw.preflight({ mode: "standard", contentClass: "general", attachmentCount: 1 }, ["claude", "ollama", "openai"]);
  assert.equal(d.claude.allow, false);
  assert.equal(d.ollama.allow, true);
  assert.equal(d.openai.allow, false);
});

test("connectFromEnv verifies env keys, stores them encrypted, and never returns key material", async () => {
  const f = fakeFetch(anthropicRoutes);
  const secrets = new MemorySecretStore();
  const gw = new Gateway({ registry: createDefaultRegistry(), fetch: f, secrets, connections: new MemoryConnectionStore() });
  const out = await gw.connectFromEnv({ ANTHROPIC_API_KEY: SECRET, OPENAI_API_KEY: "" });
  assert.deepEqual(out.map((r) => [r.providerId, r.ok]), [["claude", true]]);
  assert.ok(!JSON.stringify(out).includes(SECRET));
  const view = (await gw.listProviders("standard")).find((v) => v.descriptor.id === "claude");
  assert.equal(view.status, "ready");
  const bad = new Gateway({ registry: createDefaultRegistry(), fetch: fakeFetch([[() => true, () => jsonResponse({}, 401)]]) });
  const res = await bad.connectFromEnv({ ANTHROPIC_API_KEY: SECRET });
  assert.equal(res[0].ok, false);
  assert.ok(!JSON.stringify(res).includes(SECRET));
});
