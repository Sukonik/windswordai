/* eslint-disable @typescript-eslint/no-explicit-any -- provider wire formats are untyped JSON */
import type { AdapterContext, AdapterEvent, AdapterRequest, ModelDescriptor, ProviderAdapter, ProviderDescriptor } from "../types.ts";
import { ProviderError } from "../types.ts";
import { httpError, networkError, sseEvents, trimSlash } from "../stream.ts";

export const geminiDescriptor: ProviderDescriptor = {
  id: "gemini",
  displayName: "Google Gemini",
  vendor: "Google",
  kind: "cloud",
  order: 40,
  enabled: true,
  authMethods: [
    {
      type: "api_key",
      label: "Gemini API key (free tier or paid)",
      status: "available",
      usageSource: "api_billing",
      note: "Free tier available for development; paid billing is separate from a consumer Gemini subscription.",
    },
  ],
  suggestedModels: [],
  streaming: true,
  capabilities: { text: true, vision: true, tools: true, agent: false },
  defaultBaseUrl: "https://generativelanguage.googleapis.com",
  egress: { classification: "cloud_third_party", retention: "Sent to Google. Free-tier terms may allow product-improvement use; check your plan." },
  docsUrl: "https://ai.google.dev",
};

export function createGeminiAdapter(): ProviderAdapter {
  const base = (ctx: AdapterContext) => trimSlash(ctx.baseUrl || geminiDescriptor.defaultBaseUrl!);
  async function headers(ctx: AdapterContext) {
    const key = await ctx.getSecret();
    if (!key) throw new ProviderError("auth_failed", "Gemini is not connected.", false);
    return { "x-goog-api-key": key, "content-type": "application/json" };
  }
  return {
    descriptor: geminiDescriptor,
    async listModels(ctx): Promise<ModelDescriptor[]> {
      let res: Response;
      try {
        res = await ctx.fetch(`${base(ctx)}/v1beta/models?pageSize=100`, { headers: await headers(ctx), signal: ctx.signal });
      } catch (err) {
        throw networkError("Gemini", err);
      }
      if (!res.ok) throw httpError(res.status, "Gemini");
      const json = (await res.json()) as { models?: { name: string; displayName?: string; supportedGenerationMethods?: string[]; inputTokenLimit?: number }[] };
      return (json.models ?? [])
        .filter((m) => m.supportedGenerationMethods?.includes("generateContent"))
        .map((m) => ({ id: m.name.replace(/^models\//, ""), label: m.displayName || m.name, contextTokens: m.inputTokenLimit }));
    },
    async *stream(req: AdapterRequest, ctx: AdapterContext): AsyncGenerator<AdapterEvent> {
      const system = req.messages.filter((m) => m.role === "system").map((m) => m.content).join("\n\n");
      const contents = req.messages
        .filter((m) => m.role !== "system")
        .map((m) => ({ role: m.role === "assistant" ? "model" : "user", parts: [{ text: m.content }] }));
      let res: Response;
      try {
        res = await ctx.fetch(`${base(ctx)}/v1beta/models/${encodeURIComponent(req.model)}:streamGenerateContent?alt=sse`, {
          method: "POST",
          headers: await headers(ctx),
          body: JSON.stringify({ contents, ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}), ...(req.maxTokens ? { generationConfig: { maxOutputTokens: req.maxTokens } } : {}) }),
          signal: ctx.signal,
        });
      } catch (err) {
        throw networkError("Gemini", err);
      }
      if (!res.ok || !res.body) throw httpError(res.status, "Gemini");

      let usage: { promptTokenCount?: number; candidatesTokenCount?: number } | undefined;
      let finish = "stop";
      for await (const evt of sseEvents(res.body)) {
        let data: any;
        try { data = JSON.parse(evt.data); } catch { continue; }
        for (const part of data.candidates?.[0]?.content?.parts ?? []) if (part.text) yield { type: "delta", text: part.text };
        if (data.candidates?.[0]?.finishReason) finish = String(data.candidates[0].finishReason).toLowerCase();
        if (data.usageMetadata) usage = data.usageMetadata;
      }
      yield { type: "usage", inputTokens: usage?.promptTokenCount, outputTokens: usage?.candidatesTokenCount };
      yield { type: "done", finishReason: finish };
    },
  };
}
