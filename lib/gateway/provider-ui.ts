// Presentation metadata for providers. Logic (auth, policy, models) always comes from the gateway registry;
// this only decides how a provider is *shown*. Unknown/future providers fall back to a neutral style, so
// adding a provider to the registry needs no UI change.

export interface ProviderUi {
  /** Short product name shown on chips and buttons. */
  name: string;
  /** Vendor name for "Continue to …" copy. */
  vendor: string;
  /** One-line explanation on the connection card. */
  blurb: string;
  /** Monogram letters until official marks are licensed and added. */
  monogram: string;
  /** Accent used for the monogram badge. */
  accent: string;
}

const known: Record<string, ProviderUi> = {
  claude: { name: "Claude", vendor: "Anthropic", monogram: "C", accent: "#c9683f", blurb: "Anthropic's assistant. Strong at careful reading and drafting." },
  openai: { name: "ChatGPT", vendor: "OpenAI", monogram: "G", accent: "#10a37f", blurb: "OpenAI's models. Connect a developer account to use them here." },
  gemini: { name: "Gemini", vendor: "Google", monogram: "G", accent: "#4285f4", blurb: "Google's models. Sign in with Google where available." },
  meta: { name: "Muse", vendor: "Meta", monogram: "M", accent: "#7c5cff", blurb: "Meta's Muse models through the Meta Model API." },
  mistral: { name: "Mistral", vendor: "Mistral AI", monogram: "M", accent: "#f2711c", blurb: "Mistral's models through your Mistral workspace." },
  ollama: { name: "Ollama", vendor: "Ollama", monogram: "O", accent: "#8b93a1", blurb: "Runs models on this computer. No account, nothing leaves the device." },
  mock: { name: "Demo", vendor: "WindSwordAI", monogram: "W", accent: "#2bb8ff", blurb: "Built-in synthetic provider for trying the app safely." },
};

export function providerUi(id: string, displayName?: string): ProviderUi {
  return known[id] ?? { name: displayName ?? id, vendor: displayName ?? id, monogram: (displayName ?? id).slice(0, 1).toUpperCase(), accent: "#8b93a1", blurb: "Connected through the WindSwordAI provider registry." };
}
