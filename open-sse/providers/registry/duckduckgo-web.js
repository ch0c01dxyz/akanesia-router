// duckduckgo-web — DuckDuckGo AI Chat (duck.ai) anonymous free provider
// (OmniRoute: duckduckgo-web). No credential: VQD token acquisition +
// anti-abuse challenge solving per request, with a circuit breaker.
export default {
  id: "duckduckgo-web",
  alias: "ddgw",
  category: "free",
  authType: "none",
  noAuth: true,
  display: {
    name: "DuckDuckGo AI Chat",
    icon: "search",
    color: "#DE5833",
    textIcon: "DD",
    website: "https://duck.ai",
  },
  transport: {
    baseUrl: "https://duck.ai/duckchat/v1/chat",
    format: "openai",
    authHeader: "none",
  },
  models: [
    // OmniRoute duckduckgo-web registry (#8000): current Duck.ai free lineup,
    // wire ids per duckchat/v1/models (2026-08-26). gpt-5.4-nano was retired
    // upstream; gpt-5.6-luna joined the free tier.
    { id: "gpt-5.4-mini", name: "GPT-5.4 Mini", toolCalling: false },
    { id: "gpt-5.6-luna", name: "GPT-5.6 Luna", toolCalling: false },
    { id: "claude-haiku-4-5", name: "Claude Haiku 4.5", toolCalling: false },
    { id: "mistral-small-2603", name: "Mistral Small 4", toolCalling: false },
    { id: "tinfoil/gpt-oss-120b", name: "gpt-oss 120B", toolCalling: false },
    { id: "tinfoil/gemma4-31b", name: "Gemma 4 31B", toolCalling: false },
  ],
};
