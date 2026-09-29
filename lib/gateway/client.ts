// Browser-side gateway client. The UI talks ONLY to a WindSwordAI gateway
// (real HTTP gateway, or the in-browser demo gateway). It never calls model vendors.
import { Gateway, type ConnectInput } from "../../gateway/src/gateway.ts";
import { createDemoRegistry } from "../../gateway/src/providers/index.ts";
import { sseEvents } from "../../gateway/src/stream.ts";
import type { ChatRequest, ExecutionMode, PolicyDecision, ProviderView, StreamEvent } from "../../gateway/src/types.ts";
import { ProviderError } from "../../gateway/src/types.ts";

export type TransportKind = "demo" | "gateway";

export interface Transport {
  kind: TransportKind;
  url?: string;
  providers(mode: ExecutionMode): Promise<ProviderView[]>;
  chat(req: ChatRequest, signal?: AbortSignal): AsyncGenerator<StreamEvent>;
  preflight(req: Pick<ChatRequest, "mode" | "contentClass" | "attachmentCount">, providers: string[]): Promise<Record<string, PolicyDecision>>;
  connect(providerId: string, input: ConnectInput): Promise<ProviderView>;
  disconnect(providerId: string): Promise<void>;
  /** Begin delegated account linking; resolves to the provider authorization URL to navigate to. */
  startOAuth(providerId: string, returnTo: string): Promise<string>;
}

export interface GatewaySettings {
  url?: string;
  token?: string;
}

export type GatewayStatus =
  | { state: "checking" }
  | { state: "demo" }
  | { state: "connected"; url: string }
  | { state: "needs_token"; url: string };

/** Demo transport: same core, policy and mock adapter, running in the browser. Cloud providers cannot be connected. */
export function createDemoTransport(): Transport {
  const gateway = new Gateway({ registry: createDemoRegistry() });
  return {
    kind: "demo",
    providers: (mode) => gateway.listProviders(mode),
    chat: (req, signal) => gateway.chat(req, signal),
    preflight: (req, ids) => gateway.preflight(req, ids),
    async connect() {
      throw new ProviderError("bad_request", "Connecting accounts needs a running WindSwordAI gateway. This public demo is synthetic-only.");
    },
    async disconnect() {},
    async startOAuth() {
      throw new ProviderError("bad_request", "Connecting accounts needs the WindSwordAI app. This public demo is synthetic-only.");
    },
  };
}

function apiUrl(base: string, path: string) {
  const root = base || (typeof location !== "undefined" ? location.origin : "");
  return new URL(path, root.endsWith("/") ? root : `${root}/`).toString();
}

export function createHttpTransport(url: string, token?: string): Transport {
  const headers = (json = true): Record<string, string> => ({
    ...(json ? { "content-type": "application/json" } : {}),
    ...(token ? { authorization: `Bearer ${token}` } : {}),
  });

  async function json<T>(path: string, init?: RequestInit): Promise<T> {
    let res: Response;
    try {
      res = await fetch(apiUrl(url, path), { ...init, headers: { ...headers(Boolean(init?.body)), ...(init?.headers as object) } });
    } catch {
      throw new ProviderError("network", "Could not reach the WindSwordAI gateway.", true);
    }
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new ProviderError(body?.error?.code ?? "internal", body?.error?.message ?? `Gateway error (HTTP ${res.status}).`, res.status >= 500);
    return body as T;
  }

  return {
    kind: "gateway",
    url,
    async providers(mode) {
      return (await json<{ providers: ProviderView[] }>(`/v1/providers?mode=${mode}`)).providers;
    },
    async *chat(req, signal) {
      let res: Response;
      try {
        res = await fetch(apiUrl(url, "/v1/chat"), { method: "POST", headers: headers(), body: JSON.stringify(req), signal });
      } catch (err) {
        yield err instanceof DOMException && err.name === "AbortError"
          ? { type: "error", code: "cancelled", message: "Cancelled.", retryable: true }
          : { type: "error", code: "network", message: "Could not reach the WindSwordAI gateway.", retryable: true };
        return;
      }
      if (!res.ok || !res.body) {
        const body = await res.json().catch(() => ({}));
        yield { type: "error", code: body?.error?.code ?? "internal", message: body?.error?.message ?? `Gateway error (HTTP ${res.status}).`, retryable: res.status >= 500 };
        return;
      }
      try {
        for await (const evt of sseEvents(res.body)) yield JSON.parse(evt.data) as StreamEvent;
      } catch (err) {
        yield err instanceof DOMException && err.name === "AbortError"
          ? { type: "error", code: "cancelled", message: "Cancelled.", retryable: true }
          : { type: "error", code: "network", message: "The connection to the gateway was interrupted.", retryable: true };
      }
    },
    async preflight(req, providers) {
      return (await json<{ decisions: Record<string, PolicyDecision> }>("/v1/preflight", { method: "POST", body: JSON.stringify({ ...req, providers }) })).decisions;
    },
    async connect(providerId, input) {
      return (await json<{ provider: ProviderView }>(`/v1/connections/${providerId}`, { method: "POST", body: JSON.stringify(input) })).provider;
    },
    async disconnect(providerId) {
      await json(`/v1/connections/${providerId}`, { method: "DELETE" });
    },
    async startOAuth(providerId, returnTo) {
      return (await json<{ authorizeUrl: string }>(`/v1/connections/${providerId}/oauth/start`, { method: "POST", body: JSON.stringify({ returnTo }) })).authorizeUrl;
    },
  };
}

async function probe(url: string): Promise<{ ok: boolean; tokenRequired?: boolean }> {
  try {
    const res = await fetch(apiUrl(url, "/v1/health"), { signal: AbortSignal.timeout(1500) });
    if (!res.ok) return { ok: false };
    const body = await res.json();
    return body?.service === "windsword-gateway" ? { ok: true, tokenRequired: Boolean(body.tokenRequired) } : { ok: false };
  } catch {
    return { ok: false };
  }
}

/**
 * Look for a gateway: the configured URL, NEXT_PUBLIC_GATEWAY_URL, and (only for builds served by the
 * gateway itself, NEXT_PUBLIC_GATEWAY_SAME_ORIGIN=true) the current origin. Otherwise use the demo.
 * Same-origin probing is opt-in so the public static site never makes failing requests.
 */
export async function detectTransport(settings: GatewaySettings): Promise<{ transport: Transport; status: GatewayStatus }> {
  const sameOrigin = process.env.NEXT_PUBLIC_GATEWAY_SAME_ORIGIN === "true" ? [""] : [];
  const candidates = [settings.url, process.env.NEXT_PUBLIC_GATEWAY_URL, ...sameOrigin].filter((u): u is string => Boolean(u) || u === "");
  for (const url of new Set(candidates)) {
    const found = await probe(url);
    if (!found.ok) continue;
    const resolved = url || (typeof location !== "undefined" ? location.origin : "");
    if (found.tokenRequired && !settings.token) {
      return { transport: createDemoTransport(), status: { state: "needs_token", url: resolved } };
    }
    return { transport: createHttpTransport(url, settings.token), status: { state: "connected", url: resolved } };
  }
  return { transport: createDemoTransport(), status: { state: "demo" } };
}

/** Stable UI-side helper: provider choice key for <select> values. */
export const choiceKey = (providerId: string, model: string) => `${providerId}::${model}`;
export const parseChoice = (key: string) => {
  const i = key.indexOf("::");
  return { providerId: key.slice(0, i), model: key.slice(i + 2) };
};
