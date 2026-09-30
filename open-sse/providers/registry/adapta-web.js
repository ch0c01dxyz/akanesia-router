// adapta-web — Adapta ONE web chat (https://agent.adapta.one) via a Clerk
// session. The API key is the `__client` cookie from .clerk.agent.adapta.one;
// the executor exchanges it for a short-lived session JWT and streams the
// Adapta chat SSE protocol (OmniRoute: adapta-web).
export default {
  id: "adapta-web",
  alias: "adp-web",
  uiAlias: "adp-web",
  category: "webCookie",
  authType: "apikey",
  authModes: ["apikey"],
  display: {
    name: "Adapta Web",
    icon: "smart_toy",
    color: "#7C3AED",
    textIcon: "AD",
    website: "https://agent.adapta.one",
    notice: {
      text: "Paste your __client cookie from .clerk.agent.adapta.one as the API key (full name=value form or just the JWT value).",
      signupUrl: "https://agent.adapta.one",
    },
  },
  transport: {
    baseUrl: "https://agent.adapta.one/api/chat/stream/v1",
    format: "openai",
    authHeader: "bearer",
  },
  models: [
    { id: "adapta-one", name: "Adapta ONE (Auto)", toolCalling: false },
    { id: "adapta-gpt", name: "GPT-5 (via Adapta)", toolCalling: false },
    { id: "adapta-claude", name: "Claude Sonnet 4.6 (via Adapta)", toolCalling: false },
    { id: "adapta-gemini", name: "Gemini 2.5 Pro (via Adapta)", toolCalling: false },
    { id: "adapta-grok", name: "Grok 4 (via Adapta)", toolCalling: false },
    { id: "adapta-deepseek", name: "DeepSeek R2 (via Adapta)", toolCalling: false },
    { id: "adapta-llama", name: "Llama 4 (via Adapta)", toolCalling: false },
  ],
};
