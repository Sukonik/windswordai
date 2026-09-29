import { ProviderError } from "./types.ts";

/** Parse a Server-Sent-Events body into {event, data} records. */
export async function* sseEvents(body: ReadableStream<Uint8Array>): AsyncGenerator<{ event?: string; data: string }> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let idx: number;
      while ((idx = buffer.search(/\r?\n\r?\n/)) !== -1) {
        const raw = buffer.slice(0, idx);
        buffer = buffer.slice(idx).replace(/^\r?\n\r?\n/, "");
        const record = parseSse(raw);
        if (record) yield record;
      }
    }
    const tail = parseSse(buffer);
    if (tail) yield tail;
  } finally {
    reader.releaseLock();
  }
}

function parseSse(raw: string): { event?: string; data: string } | undefined {
  let event: string | undefined;
  const data: string[] = [];
  for (const line of raw.split(/\r?\n/)) {
    if (line.startsWith(":") || !line) continue;
    if (line.startsWith("event:")) event = line.slice(6).trim();
    else if (line.startsWith("data:")) data.push(line.slice(5).replace(/^ /, ""));
  }
  return data.length ? { event, data: data.join("\n") } : undefined;
}

/** Newline-delimited JSON (Ollama). */
export async function* ndjson(body: ReadableStream<Uint8Array>): AsyncGenerator<unknown> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let idx: number;
      while ((idx = buffer.indexOf("\n")) !== -1) {
        const line = buffer.slice(0, idx).trim();
        buffer = buffer.slice(idx + 1);
        if (line) yield JSON.parse(line);
      }
    }
    if (buffer.trim()) yield JSON.parse(buffer.trim());
  } finally {
    reader.releaseLock();
  }
}

/** Map an HTTP failure to a provider-neutral error. Never includes the response body verbatim. */
export function httpError(status: number, providerName: string): ProviderError {
  if (status === 401 || status === 403) return new ProviderError("auth_failed", `${providerName} rejected the credentials.`, false);
  if (status === 429) return new ProviderError("rate_limited", `${providerName} rate limit reached. Try again shortly.`, true);
  if (status === 400 || status === 404 || status === 422) return new ProviderError("bad_request", `${providerName} could not process that request (HTTP ${status}).`, false);
  if (status >= 500) return new ProviderError("provider_unavailable", `${providerName} is temporarily unavailable (HTTP ${status}).`, true);
  return new ProviderError("internal", `${providerName} returned HTTP ${status}.`, false);
}

export function trimSlash(url: string): string {
  return url.replace(/\/+$/, "");
}

export function networkError(providerName: string, err: unknown): ProviderError {
  if (err instanceof ProviderError) return err;
  if (err instanceof DOMException && err.name === "AbortError") return new ProviderError("cancelled", "Request cancelled.", false);
  return new ProviderError("network", `Could not reach ${providerName}.`, true);
}
