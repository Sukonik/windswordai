import type { AdapterContext, AdapterEvent, AdapterRequest, ModelDescriptor, ProviderAdapter, ProviderDescriptor } from "../types.ts";
import { ProviderError } from "../types.ts";
import { httpError, ndjson, networkError, trimSlash } from "../stream.ts";

export const ollamaDescriptor: ProviderDescriptor = {
  id: "ollama",
  displayName: "Ollama (local)",
  vendor: "Ollama",
  kind: "local",
  order: 60,
  enabled: true,
  authMethods: [{ type: "local", label: "Local runtime", status: "available", usageSource: "local", note: "Runs on your machine. No account, no cloud." }],
  suggestedModels: [],
  streaming: true,
  capabilities: { text: true, vision: false, tools: false, agent: false },
  defaultBaseUrl: "http://127.0.0.1:11434",
  egress: { classification: "none", retention: "Nothing leaves your machine." },
  docsUrl: "https://ollama.com",
};

export function createOllamaAdapter(): ProviderAdapter {
  const base = (ctx: AdapterContext) => trimSlash(ctx.baseUrl || ollamaDescriptor.defaultBaseUrl!);
  return {
    descriptor: ollamaDescriptor,
    async listModels(ctx: AdapterContext): Promise<ModelDescriptor[]> {
      try {
        const res = await ctx.fetch(`${base(ctx)}/api/tags`, { signal: ctx.signal });
        if (!res.ok) throw httpError(res.status, "Ollama");
        const json = (await res.json()) as { models?: { name: string }[] };
        return (json.models ?? []).map((m) => ({ id: m.name, label: m.name }));
      } catch (err) {
        throw err instanceof ProviderError ? err : new ProviderError("network", "Ollama is not running on this machine.", true);
      }
    },
    async *stream(req: AdapterRequest, ctx: AdapterContext): AsyncGenerator<AdapterEvent> {
      let res: Response;
      try {
        res = await ctx.fetch(`${base(ctx)}/api/chat`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ model: req.model, messages: req.messages, stream: true, options: req.maxTokens ? { num_predict: req.maxTokens } : undefined }),
          signal: ctx.signal,
        });
      } catch (err) {
        throw networkError("Ollama", err);
      }
      if (!res.ok || !res.body) throw httpError(res.status, "Ollama");
      for await (const line of ndjson(res.body)) {
        const chunk = line as { message?: { content?: string }; done?: boolean; done_reason?: string; prompt_eval_count?: number; eval_count?: number; error?: string };
        if (chunk.error) throw new ProviderError("bad_request", "Ollama reported an error for that request.", false);
        if (chunk.message?.content) yield { type: "delta", text: chunk.message.content };
        if (chunk.done) {
          yield { type: "usage", inputTokens: chunk.prompt_eval_count, outputTokens: chunk.eval_count };
          yield { type: "done", finishReason: chunk.done_reason ?? "stop" };
        }
      }
    },
  };
}
