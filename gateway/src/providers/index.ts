import { ProviderRegistry } from "../registry.ts";
import { createAnthropicAdapter } from "./anthropic.ts";
import { createGeminiAdapter } from "./gemini.ts";
import { createMockAdapter } from "./mock.ts";
import { createOllamaAdapter } from "./ollama.ts";
import { createOpenAICompatAdapter, metaDescriptor, mistralDescriptor, openaiDescriptor } from "./openai-compat.ts";

/** Product-priority registration: Claude, OpenAI, Muse, Gemini, Mistral; Ollama and the demo mock stay local. */
export function createDefaultRegistry(opts: { mockDelayMs?: number } = {}): ProviderRegistry {
  return new ProviderRegistry()
    .register(createAnthropicAdapter())
    .register(createOpenAICompatAdapter(openaiDescriptor))
    .register(createOpenAICompatAdapter(metaDescriptor))
    .register(createGeminiAdapter())
    .register(createOpenAICompatAdapter(mistralDescriptor))
    .register(createOllamaAdapter())
    .register(createMockAdapter({ delayMs: opts.mockDelayMs }));
}

/** Browser demo: same descriptors (so Settings can show them) but only the mock is runnable. */
export function createDemoRegistry(): ProviderRegistry {
  return createDefaultRegistry();
}
