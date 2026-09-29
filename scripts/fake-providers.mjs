// Fake vendor APIs (Anthropic-shaped and OpenAI-shaped) for offline end-to-end tests.
// Run standalone:  node scripts/fake-providers.mjs 9911
import { createServer } from "node:http";

export const FAKE_KEYS = { claude: "sk-fake-claude-000111", openai: "sk-fake-openai-000222" };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function startFakeProviders(port = 0) {
  const requests = [];
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, "http://x");
    let body = "";
    for await (const c of req) body += c;
    requests.push({ method: req.method, path: url.pathname, headers: req.headers, body });
    const send = (status, obj) => { res.writeHead(status, { "content-type": "application/json" }); res.end(JSON.stringify(obj)); };

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
  return new Promise((resolve) => server.listen(port, "127.0.0.1", () => resolve({ server, port: server.address().port, requests })));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { port } = await startFakeProviders(Number(process.argv[2] ?? 9911));
  console.log(`Fake provider upstreams on http://127.0.0.1:${port} (claude key ${FAKE_KEYS.claude}, openai key ${FAKE_KEYS.openai})`);
}
