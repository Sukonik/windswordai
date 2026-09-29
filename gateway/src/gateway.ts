import { AuditLog, decisionSummary, requestCounts } from "./audit.ts";
import { decideRequest } from "./policy.ts";
import type { ProviderRegistry } from "./registry.ts";
import type { ConnectionStore, SecretStore } from "./stores.ts";
import { MemoryConnectionStore, MemorySecretStore } from "./stores.ts";
import type {
  AdapterContext, ChatRequest, Connection, ConnectionType, ErrorCode, ExecutionMode, ModelDescriptor, PolicyDecision, ProviderView, StreamEvent,
} from "./types.ts";
import { ProviderError } from "./types.ts";
import { decide } from "./policy.ts";

export interface GatewayOptions {
  registry: ProviderRegistry;
  secrets?: SecretStore;
  connections?: ConnectionStore;
  audit?: AuditLog;
  fetch?: typeof fetch;
  /** Cloud providers explicitly approved for protected material (default: none). */
  approvedForProtected?: ReadonlySet<string>;
  requestTimeoutMs?: number;
  /** Probe local runtimes (e.g. Ollama) when listing providers. Server only; never in the browser demo. */
  probeLocal?: boolean;
}

export interface ConnectInput {
  type: ConnectionType;
  apiKey?: string;
  baseUrl?: string;
  label?: string;
}

const LOCAL_NEEDS_NO_CONNECTION = (kind: string) => kind === "local";

function newId(prefix: string) {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36).slice(-4)}`;
}

/** Remove any occurrence of a secret from text that might be surfaced to the UI or logs. */
export function redactSecret(text: string, secret?: string) {
  return secret && secret.length >= 6 ? text.split(secret).join("[redacted]") : text;
}

/**
 * The single, auditable gateway path. Chat, compare and every future feature call
 * providers only through Gateway.chat(), which runs policy first and audits every call.
 */
export class Gateway {
  readonly registry: ProviderRegistry;
  readonly audit: AuditLog;
  private secrets: SecretStore;
  private connections: ConnectionStore;
  private fetchImpl: typeof fetch;
  private approved: ReadonlySet<string>;
  private timeoutMs: number;
  private probeLocal: boolean;

  constructor(opts: GatewayOptions) {
    this.registry = opts.registry;
    this.audit = opts.audit ?? new AuditLog();
    this.secrets = opts.secrets ?? new MemorySecretStore();
    this.connections = opts.connections ?? new MemoryConnectionStore();
    this.fetchImpl = opts.fetch ?? fetch.bind(globalThis);
    this.approved = opts.approvedForProtected ?? new Set();
    this.timeoutMs = opts.requestTimeoutMs ?? 120_000;
    this.probeLocal = opts.probeLocal ?? false;
  }

  private async isConnected(providerId: string): Promise<boolean> {
    const desc = this.registry.descriptor(providerId);
    if (!desc) return false;
    if (LOCAL_NEEDS_NO_CONNECTION(desc.kind)) return true;
    return Boolean(await this.connections.get(providerId));
  }

  async listProviders(mode: ExecutionMode): Promise<ProviderView[]> {
    const views: ProviderView[] = [];
    for (const adapter of this.registry.list()) {
      const d = adapter.descriptor;
      const conn = await this.connections.get(d.id);
      const connected = d.kind === "local" || Boolean(conn);
      let liveModels: ModelDescriptor[] | undefined;
      let offline = false;
      if (d.kind === "local" && d.id !== "mock" && this.probeLocal) {
        try {
          liveModels = await adapter.listModels({ fetch: this.fetchImpl, baseUrl: conn?.baseUrl, getSecret: async () => undefined, signal: AbortSignal.timeout(1500) });
        } catch {
          offline = true;
        }
      }
      const eligibility = decide({ mode, provider: d, connected, contentClass: "general", approvedForProtected: this.approved });
      const protectedEligibility = decide({ mode, provider: d, connected, contentClass: "protected", approvedForProtected: this.approved });
      const publicConn = conn ? { ...conn, secretRef: undefined } : undefined;
      views.push({
        descriptor: d,
        connection: publicConn as ProviderView["connection"],
        status: !d.enabled ? "disabled" : offline ? "offline" : connected ? "ready" : "not_connected",
        models: liveModels ?? (conn?.models?.length ? conn.models : d.suggestedModels),
        eligibility,
        protectedEligibility,
      });
    }
    return views;
  }

  /** Validate credentials by probing live models (capability detection), then store encrypted. */
  async connect(providerId: string, input: ConnectInput): Promise<ProviderView> {
    const adapter = this.registry.get(providerId);
    if (!adapter) throw new ProviderError("bad_request", "Unknown provider.");
    const d = adapter.descriptor;
    const method = d.authMethods.find((m) => m.type === input.type);
    if (!method || method.status !== "available") {
      throw new ProviderError("bad_request", method ? `That connection method is ${method.status} for ${d.displayName}. ${method.note}` : "Unsupported connection method.");
    }
    if (d.requiresBaseUrl && !input.baseUrl) throw new ProviderError("bad_request", `${d.displayName} needs a base URL.`);
    if (input.baseUrl && !/^https?:\/\//i.test(input.baseUrl)) throw new ProviderError("bad_request", "Base URL must start with http:// or https://");

    let secretRef: string | undefined;
    let models: ModelDescriptor[] = [];
    const apiKey = input.apiKey?.trim();
    if (input.type === "api_key") {
      if (!apiKey) throw new ProviderError("bad_request", "An API key is required.");
      const ctx: AdapterContext = { fetch: this.fetchImpl, baseUrl: input.baseUrl, getSecret: async () => apiKey, signal: AbortSignal.timeout(20_000) };
      try {
        models = await adapter.listModels(ctx);
      } catch (err) {
        if (err instanceof ProviderError) throw new ProviderError(err.code, redactSecret(err.message, apiKey), err.retryable);
        throw new ProviderError("network", `Could not verify the ${d.displayName} credentials.`, true);
      }
      secretRef = await this.secrets.put(apiKey);
    }
    if (input.type === "local") {
      const ctx: AdapterContext = { fetch: this.fetchImpl, baseUrl: input.baseUrl, getSecret: async () => undefined, signal: AbortSignal.timeout(5_000) };
      models = await adapter.listModels(ctx);
    }
    const prev = await this.connections.get(providerId);
    if (prev?.secretRef) await this.secrets.delete(prev.secretRef);
    const conn: Connection = {
      providerId,
      type: input.type,
      label: input.label,
      baseUrl: input.baseUrl,
      secretRef,
      models: models.length ? models : d.suggestedModels,
      connectedAt: new Date().toISOString(),
    };
    await this.connections.set(conn);
    this.audit.record({ type: "connection.added", providerId, connectionType: input.type });
    return (await this.listProviders("standard")).find((v) => v.descriptor.id === providerId)!;
  }

  /**
   * Connect providers from conventional environment variables (developer convenience).
   * Keys are verified and moved into the vault; results never include key material.
   */
  async connectFromEnv(env: Record<string, string | undefined>): Promise<{ providerId: string; ok: boolean; message: string }[]> {
    const map: [string, string, string?][] = [
      ["claude", "ANTHROPIC_API_KEY", "ANTHROPIC_BASE_URL"],
      ["openai", "OPENAI_API_KEY", "OPENAI_BASE_URL"],
      ["gemini", "GEMINI_API_KEY", "GEMINI_BASE_URL"],
      ["mistral", "MISTRAL_API_KEY", "MISTRAL_BASE_URL"],
      ["meta", "META_API_KEY", "META_BASE_URL"],
    ];
    const out: { providerId: string; ok: boolean; message: string }[] = [];
    for (const [providerId, keyVar, urlVar] of map) {
      const apiKey = env[keyVar];
      if (!apiKey || !this.registry.get(providerId)) continue;
      if (await this.connections.get(providerId)) { out.push({ providerId, ok: true, message: "Already connected." }); continue; }
      try {
        await this.connect(providerId, { type: "api_key", apiKey, baseUrl: (urlVar && env[urlVar]) || undefined, label: `from ${keyVar}` });
        out.push({ providerId, ok: true, message: `Connected from ${keyVar}.` });
      } catch (err) {
        out.push({ providerId, ok: false, message: err instanceof ProviderError ? redactSecret(err.message, apiKey) : "Could not verify." });
      }
    }
    return out;
  }

  /** Delete stored credential material and the connection record. */
  async disconnect(providerId: string): Promise<void> {
    const conn = await this.connections.get(providerId);
    if (conn?.secretRef) await this.secrets.delete(conn.secretRef);
    await this.connections.delete(providerId);
    this.audit.record({ type: "connection.removed", providerId });
  }

  /** Preflight policy decisions (used by the UI to disable choices with reasons, and for compare). */
  async preflight(
    req: Pick<ChatRequest, "mode" | "contentClass" | "attachmentCount">,
    providerIds: string[],
  ): Promise<Record<string, PolicyDecision>> {
    const out: Record<string, PolicyDecision> = {};
    for (const id of providerIds) {
      out[id] = decideRequest(req, this.registry.descriptor(id), await this.isConnected(id), this.approved);
    }
    return out;
  }

  async *chat(req: ChatRequest, external?: AbortSignal): AsyncGenerator<StreamEvent> {
    const sessionId = req.sessionId || newId("ses");
    const base = { sessionId, compareGroupId: req.compareGroupId, providerId: req.providerId, model: req.model, mode: req.mode, contentClass: req.contentClass };
    const counts = requestCounts(req);
    const descriptor = this.registry.descriptor(req.providerId);

    // 1. Policy gate: single decision point, before any provider code runs.
    const decision = decideRequest(req, descriptor, await this.isConnected(req.providerId), this.approved);
    this.audit.record({ type: "policy.decision", ...base, decision: decisionSummary(decision), counts });
    if (!decision.allow) {
      yield { type: "blocked", code: decision.code, reason: decision.reason };
      return;
    }

    const adapter = this.registry.get(req.providerId)!;
    const conn = await this.connections.get(req.providerId);
    const secret = conn?.secretRef ? await this.secrets.get(conn.secretRef) : undefined;

    const controller = new AbortController();
    const onAbort = () => controller.abort();
    external?.addEventListener("abort", onAbort, { once: true });
    const timer = setTimeout(() => controller.abort(new DOMException("Timeout", "TimeoutError")), this.timeoutMs);
    const ctx: AdapterContext = { fetch: this.fetchImpl, baseUrl: conn?.baseUrl, getSecret: async () => secret, signal: controller.signal };

    this.audit.record({ type: "chat.start", ...base, counts });
    yield { type: "start", sessionId, providerId: req.providerId, model: req.model };

    let replyChars = 0;
    let usage: { inputTokens?: number; outputTokens?: number } | undefined;
    try {
      for await (const evt of adapter.stream({ model: req.model, messages: req.messages, maxTokens: req.maxTokens }, ctx)) {
        if (evt.type === "delta") {
          replyChars += evt.text.length;
          yield { type: "delta", text: redactSecret(evt.text, secret) };
        } else if (evt.type === "usage") {
          usage = { inputTokens: evt.inputTokens, outputTokens: evt.outputTokens };
          yield evt;
        } else {
          yield evt;
        }
      }
      this.audit.record({ type: "chat.end", ...base, counts: { ...counts, replyChars }, usage });
    } catch (err) {
      let code: ErrorCode = "internal";
      let message = "Something went wrong while contacting the provider.";
      let retryable = false;
      if (controller.signal.aborted && external?.aborted) {
        code = "cancelled"; message = "Cancelled."; retryable = true;
      } else if (controller.signal.aborted) {
        code = "timeout"; message = "The provider took too long to respond."; retryable = true;
      } else if (err instanceof ProviderError) {
        code = err.code; message = redactSecret(err.message, secret); retryable = err.retryable;
      } else if (err instanceof DOMException && err.name === "AbortError") {
        code = "cancelled"; message = "Cancelled."; retryable = true;
      }
      this.audit.record({ type: "chat.error", ...base, counts: { ...counts, replyChars }, errorCode: code });
      yield { type: "error", code, message, retryable };
    } finally {
      clearTimeout(timer);
      external?.removeEventListener("abort", onAbort);
    }
  }
}
