/* eslint-disable @typescript-eslint/no-explicit-any -- provider wire formats are untyped JSON */
import type { AdapterContext, AdapterEvent, AdapterRequest, ModelDescriptor, ProviderAdapter, ProviderDescriptor } from "../types.ts";
import { ProviderError } from "../types.ts";
import { httpError, networkError, sseEvents, trimSlash } from "../stream.ts";

export const anthropicDescriptor: ProviderDescriptor = {
  id: "claude",
  displayName: "Claude",
  vendor: "Anthropic",
  kind: "cloud",
  order: 10,
  enabled: true,
  authMethods: [
    {
      type: "api_key",
      label: "Anthropic Console / API key",
      status: "available",
      usageSource: "api_billing",
      note: "Billed to your Anthropic Console account. This is separate from a Claude subscription.",
    },
    {
      type: "subscription",
      label: "Claude subscription (Agent SDK)",
      status: "planned",
      usageSource: "subscription",
      note: "Anthropic documents subscription-linked usage through the Claude Agent SDK. Not enabled until a documented flow is verified; the gateway keeps a capability probe because the policy has changed before. Never uses browser cookies or scraped sessions.",
    },
  ],
  suggestedModels: [
    { id: "claude-sonnet-5-5", label: "Claude Sonnet 5.5" },
    { id: "claude-opus-5-5", label: "Claude Opus 5.5" },
    { id: "claude-haiku-4-5-20251001", label: "Claude Haiku 4.5" },
  ],
  streaming: true,
  capabilities: { text: true, vision: true, tools: true, agent: true },
  defaultBaseUrl: "https://api.anthropic.com",
  egress: { classification: "cloud_third_party", retention: "Sent to Anthropic under your account's data terms." },
  docsUrl: "https://docs.anthropic.com",
};

const VERSION = "2023-06-01";

export function createAnthropicAdapter(): ProviderAdapter {
  const base = (ctx: AdapterContext) => trimSlash(ctx.baseUrl || anthropicDescriptor.defaultBaseUrl!);
  async function headers(ctx: AdapterContext) {
    const key = await ctx.getSecret();
    if (!key) throw new ProviderError("auth_failed", "Claude is not connected.", false);
    return { "x-api-key": key, "anthropic-version": VERSION, "content-type": "application/json" };
  }
  return {
    descriptor: anthropicDescriptor,
    async listModels(ctx): Promise<ModelDescriptor[]> {
      let res: Response;
      try {
        res = await ctx.fetch(`${base(ctx)}/v1/models?limit=100`, { headers: await headers(ctx), signal: ctx.signal });
      } catch (err) {
        throw networkError("Anthropic", err);
      }
      if (!res.ok) throw httpError(res.status, "Anthropic");
      const json = (await res.json()) as { data?: { id: string; display_name?: string }[] };
      return (json.data ?? []).map((m) => ({ id: m.id, label: m.display_name || m.id }));
    },
    async *stream(req: AdapterRequest, ctx: AdapterContext): AsyncGenerator<AdapterEvent> {
      const system = req.messages.filter((m) => m.role === "system").map((m) => m.content).join("\n\n");
      const messages = req.messages.filter((m) => m.role !== "system").map((m) => ({ role: m.role, content: m.content }));
      let res: Response;
      try {
        res = await ctx.fetch(`${base(ctx)}/v1/messages`, {
          method: "POST",
          headers: await headers(ctx),
          body: JSON.stringify({ model: req.model, max_tokens: req.maxTokens ?? 2048, stream: true, ...(system ? { system } : {}), messages }),
          signal: ctx.signal,
        });
      } catch (err) {
        throw networkError("Anthropic", err);
      }
      if (!res.ok || !res.body) throw httpError(res.status, "Anthropic");

      let inputTokens: number | undefined;
      let outputTokens: number | undefined;
      let finish = "stop";
      for await (const evt of sseEvents(res.body)) {
        let data: any;
        try { data = JSON.parse(evt.data); } catch { continue; }
        switch (data.type) {
          case "message_start": inputTokens = data.message?.usage?.input_tokens; break;
          case "content_block_delta": if (data.delta?.type === "text_delta" && data.delta.text) yield { type: "delta", text: data.delta.text }; break;
          case "message_delta": outputTokens = data.usage?.output_tokens ?? outputTokens; finish = data.delta?.stop_reason ?? finish; break;
          case "error": throw new ProviderError(data.error?.type === "overloaded_error" ? "provider_unavailable" : "internal", "Anthropic reported an error mid-stream.", data.error?.type === "overloaded_error");
        }
      }
      yield { type: "usage", inputTokens, outputTokens };
      yield { type: "done", finishReason: finish };
    },
  };
}
