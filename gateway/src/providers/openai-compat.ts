/* eslint-disable @typescript-eslint/no-explicit-any -- provider wire formats are untyped JSON */
import type { AdapterContext, AdapterEvent, AdapterRequest, ModelDescriptor, ProviderAdapter, ProviderDescriptor } from "../types.ts";
import { ProviderError } from "../types.ts";
import { httpError, networkError, sseEvents, trimSlash } from "../stream.ts";

/**
 * One adapter for every OpenAI-Chat-Completions-compatible API. OpenAI, Mistral and
 * Meta's Model API (which exposes an OpenAI-SDK-compatible route) are descriptors over this.
 */
export function createOpenAICompatAdapter(descriptor: ProviderDescriptor, opts: { modelsPath?: string; chatPath?: string } = {}): ProviderAdapter {
  const base = (ctx: AdapterContext) => {
    const url = ctx.baseUrl || descriptor.defaultBaseUrl;
    if (!url) throw new ProviderError("bad_request", `${descriptor.displayName} needs a base URL.`, false);
    return trimSlash(url);
  };
  async function auth(ctx: AdapterContext) {
    const key = await ctx.getSecret();
    if (!key) throw new ProviderError("auth_failed", `${descriptor.displayName} is not connected.`, false);
    return { authorization: `Bearer ${key}`, "content-type": "application/json" };
  }
  return {
    descriptor,
    async listModels(ctx): Promise<ModelDescriptor[]> {
      let res: Response;
      try {
        res = await ctx.fetch(`${base(ctx)}${opts.modelsPath ?? "/models"}`, { headers: await auth(ctx), signal: ctx.signal });
      } catch (err) {
        throw networkError(descriptor.displayName, err);
      }
      if (!res.ok) throw httpError(res.status, descriptor.displayName);
      const json = (await res.json()) as { data?: { id: string }[] };
      // Drop obviously non-chat models (embeddings, audio, image, moderation) from chat pickers.
      const NON_CHAT = /embed|whisper|tts|dall-e|moderation|image|audio|realtime|transcribe|davinci|babbage|ocr/i;
      return (json.data ?? []).filter((m) => !NON_CHAT.test(m.id)).map((m) => ({ id: m.id, label: m.id })).sort((a, b) => a.id.localeCompare(b.id));
    },
    async *stream(req: AdapterRequest, ctx: AdapterContext): AsyncGenerator<AdapterEvent> {
      let res: Response;
      try {
        res = await ctx.fetch(`${base(ctx)}${opts.chatPath ?? "/chat/completions"}`, {
          method: "POST",
          headers: await auth(ctx),
          body: JSON.stringify({ model: req.model, messages: req.messages, stream: true, stream_options: { include_usage: true }, ...(req.maxTokens ? { max_tokens: req.maxTokens } : {}) }),
          signal: ctx.signal,
        });
      } catch (err) {
        throw networkError(descriptor.displayName, err);
      }
      if (!res.ok || !res.body) throw httpError(res.status, descriptor.displayName);

      let finish = "stop";
      let usage: { prompt_tokens?: number; completion_tokens?: number } | undefined;
      for await (const evt of sseEvents(res.body)) {
        if (evt.data === "[DONE]") break;
        let data: any;
        try { data = JSON.parse(evt.data); } catch { continue; }
        const choice = data.choices?.[0];
        if (choice?.delta?.content) yield { type: "delta", text: choice.delta.content };
        if (choice?.finish_reason) finish = choice.finish_reason;
        if (data.usage) usage = data.usage;
      }
      yield { type: "usage", inputTokens: usage?.prompt_tokens, outputTokens: usage?.completion_tokens };
      yield { type: "done", finishReason: finish };
    },
  };
}

const cloudEgress = (name: string) => ({ classification: "cloud_third_party" as const, retention: `Sent to ${name} under your account's data terms.` });

export const openaiDescriptor: ProviderDescriptor = {
  id: "openai",
  displayName: "OpenAI / ChatGPT",
  vendor: "OpenAI",
  kind: "cloud",
  order: 20,
  enabled: true,
  authMethods: [
    {
      type: "api_key",
      label: "OpenAI developer API key",
      status: "available",
      usageSource: "api_billing",
      note: "Billed to your OpenAI API account. A ChatGPT Plus/Pro subscription does not pay for API usage.",
    },
    {
      type: "subscription",
      label: "Sign in with ChatGPT",
      status: "unsupported",
      usageSource: "subscription",
      note: "Sign in with ChatGPT is identity only; it does not hand a third-party app the subscription's usage. Planned instead: WindSwordAI as a plugin/app inside ChatGPT.",
    },
  ],
  suggestedModels: [],
  streaming: true,
  capabilities: { text: true, vision: true, tools: true, agent: false },
  defaultBaseUrl: "https://api.openai.com/v1",
  egress: cloudEgress("OpenAI"),
  docsUrl: "https://platform.openai.com/docs",
};

export const metaDescriptor: ProviderDescriptor = {
  id: "meta",
  displayName: "Meta Muse",
  vendor: "Meta",
  kind: "cloud",
  order: 30,
  enabled: true,
  authMethods: [
    {
      type: "api_key",
      label: "Meta Model API key",
      status: "available",
      usageSource: "api_billing",
      note: "Uses Meta's OpenAI-SDK-compatible route. Enter the base URL from Meta's Model API docs. Consumer Muse accounts are separate.",
    },
  ],
  suggestedModels: [],
  streaming: true,
  capabilities: { text: true, vision: false, tools: false, agent: false },
  requiresBaseUrl: true,
  egress: cloudEgress("Meta"),
};

export const mistralDescriptor: ProviderDescriptor = {
  id: "mistral",
  displayName: "Mistral",
  vendor: "Mistral AI",
  kind: "cloud",
  order: 50,
  enabled: true,
  authMethods: [
    {
      type: "api_key",
      label: "Mistral Studio API key",
      status: "available",
      usageSource: "api_billing",
      note: "Billed to your Mistral workspace. Le Chat consumer access is separate.",
    },
  ],
  suggestedModels: [],
  streaming: true,
  capabilities: { text: true, vision: false, tools: true, agent: false },
  defaultBaseUrl: "https://api.mistral.ai/v1",
  egress: cloudEgress("Mistral AI"),
  docsUrl: "https://docs.mistral.ai",
};
