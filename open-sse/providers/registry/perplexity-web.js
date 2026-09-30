export default {
  id: "perplexity-web",
  priority: 220,
  alias: "perplexity-web",
  aliases: [
    "pw",
  ],
  uiAlias: "pw",
  display: {
    name: "Perplexity Web (Pro/Max)",
    icon: "search",
    color: "#20808D",
    textIcon: "PW",
    website: "https://www.perplexity.ai",
  },
  category: "webCookie",
  authType: "cookie",
  authHint: "Paste your __Secure-next-auth.session-token cookie value from perplexity.ai",
  transport: {
    baseUrl: "https://www.perplexity.ai/rest/sse/perplexity_ask",
    format: "perplexity-web",
    authType: "cookie",
  },
  // Endpoint web tidak mendukung tool calling sama sekali (disinkron dari OmniRoute).
  unsupportedParams: ["tools", "tool_choice", "parallel_tool_calls"],
  models: [
    { id: "pplx-auto", name: "Perplexity Best", toolCalling: false },
    { id: "pplx-sonar", name: "Sonar 2 (via Perplexity)", toolCalling: false },
    { id: "pplx-gpt-5.6-terra", name: "GPT-5.6 Terra (via Perplexity)", toolCalling: false },
    { id: "pplx-gpt-5.6-sol", name: "GPT-5.6 Sol (via Perplexity)", toolCalling: false },
    { id: "pplx-gemini", name: "Gemini 3.7 Flash (via Perplexity)", toolCalling: false },
    { id: "pplx-sonnet", name: "Claude Sonnet 5.0 (via Perplexity)", toolCalling: false },
    { id: "pplx-opus", name: "Claude Opus 5.0 (via Perplexity)", toolCalling: false },
    { id: "pplx-glm", name: "GLM-5.2 (via Perplexity)", toolCalling: false },
    { id: "pplx-kimi", name: "Kimi K3 (via Perplexity)", toolCalling: false },
    { id: "pplx-grok-4.6", name: "Grok 4.6 (via Perplexity)", toolCalling: false },
    { id: "pplx-nemotron", name: "Nemotron 3 Ultra (via Perplexity)", toolCalling: false },
  ],
};
