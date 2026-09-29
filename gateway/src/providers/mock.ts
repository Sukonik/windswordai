import type { AdapterContext, AdapterEvent, AdapterRequest, ModelDescriptor, ProviderAdapter, ProviderDescriptor } from "../types.ts";
import { ProviderError } from "../types.ts";

const models: ModelDescriptor[] = [
  { id: "mock-legal", label: "Mock · Legal demo", contextTokens: 8000 },
  { id: "mock-fast", label: "Mock · Fast", contextTokens: 8000 },
];

export const mockDescriptor: ProviderDescriptor = {
  id: "mock",
  displayName: "Demo (mock)",
  vendor: "WindSwordAI",
  kind: "local",
  order: 100,
  enabled: true,
  authMethods: [{ type: "local", label: "Built-in", status: "available", usageSource: "local", note: "Synthetic responses. No model, no network, no account." }],
  suggestedModels: models,
  streaming: true,
  capabilities: { text: true, vision: false, tools: false, agent: false },
  egress: { classification: "none", retention: "Nothing leaves the device." },
};

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    if (signal?.aborted) return reject(new DOMException("Aborted", "AbortError"));
    const t = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => { clearTimeout(t); reject(new DOMException("Aborted", "AbortError")); }, { once: true });
  });

/** Deterministic mock provider for demos and CI. Prompt keywords exercise failure paths. */
export function createMockAdapter(opts: { delayMs?: number } = {}): ProviderAdapter {
  const delay = opts.delayMs ?? 18;
  return {
    descriptor: mockDescriptor,
    async listModels() {
      return models;
    },
    async *stream(req: AdapterRequest, ctx: AdapterContext): AsyncGenerator<AdapterEvent> {
      const last = [...req.messages].reverse().find((m) => m.role === "user")?.content ?? "";
      if (last.includes("[fail]")) throw new ProviderError("provider_unavailable", "Mock provider simulated an outage.", true);
      if (last.includes("[auth]")) throw new ProviderError("auth_failed", "Mock provider simulated rejected credentials.", false);
      const slow = last.includes("[slow]") ? 10 : 1;
      const topic = last.replace(/\[(fail|auth|slow)\]/g, "").trim().slice(0, 80) || "your question";
      const text =
        `This is the WindSwordAI demo provider, so no real model or legal document has been contacted. ` +
        `You asked about “${topic}”. In a connected setup this reply would come from the provider you selected ` +
        `(${req.model}), routed through the policy gateway with data-egress checks first.`;
      const words = text.split(/(\s+)/);
      for (const word of words) {
        if (ctx.signal?.aborted) throw new DOMException("Aborted", "AbortError");
        yield { type: "delta", text: word };
        if (delay) await sleep(delay * slow, ctx.signal);
      }
      const inputTokens = Math.ceil(req.messages.reduce((n, m) => n + m.content.length, 0) / 4);
      yield { type: "usage", inputTokens, outputTokens: Math.ceil(text.length / 4) };
      yield { type: "done", finishReason: "stop" };
    },
  };
}
