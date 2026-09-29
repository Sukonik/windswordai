// Test helpers: fake fetch that streams provider-shaped bodies in awkward chunks.
export function streamBody(text, chunkSize = 7) {
  const enc = new TextEncoder();
  const bytes = enc.encode(text);
  let i = 0;
  return new ReadableStream({
    pull(controller) {
      if (i >= bytes.length) return controller.close();
      controller.enqueue(bytes.slice(i, i + chunkSize));
      i += chunkSize;
    },
  });
}

export function sseResponse(events) {
  const text = events.map((e) => (e.event ? `event: ${e.event}\n` : "") + `data: ${typeof e.data === "string" ? e.data : JSON.stringify(e.data)}\n\n`).join("");
  return new Response(streamBody(text), { status: 200, headers: { "content-type": "text/event-stream" } });
}

export function jsonResponse(obj, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json" } });
}

/** routes: array of [predicate(url, init), handler(url, init) => Response] */
export function fakeFetch(routes) {
  const calls = [];
  const fn = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    for (const [match, handler] of routes) {
      if (match(String(url), init)) return handler(String(url), init);
    }
    return new Response("not found", { status: 404 });
  };
  fn.calls = calls;
  return fn;
}

export async function collect(gen) {
  const out = [];
  for await (const e of gen) out.push(e);
  return out;
}
