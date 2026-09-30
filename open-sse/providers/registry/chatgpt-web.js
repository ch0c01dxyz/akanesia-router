// chatgpt-web — ChatGPT browser-session provider (OmniRoute: chatgpt-web).
// Executes turns through a real logged-in chatgpt.com browser context; the
// credential is the browser storage-state JSON (cookies + local storage).
export default {
  id: "chatgpt-web",
  alias: "chatgpt-web",
  display: {
    name: "ChatGPT Web",
    icon: "chat",
    color: "#10A37F",
    textIcon: "CW",
    website: "https://chatgpt.com",
    notice: {
      text: "Paste your chatgpt.com browser storage state (Playwright storageState JSON with cookies + local storage) as the credential.",
    },
  },
  category: "webCookie",
  authType: "cookie",
  authModes: ["cookie"],
  transport: {
    baseUrl: "https://chatgpt.com",
    format: "openai",
    authHeader: "cookie",
    reasoningTransport: "opaque",
  },
  models: [
    { id: "gpt-5-6", name: "GPT-5.6 Sol — Instant", toolCalling: false, supportsVision: true },
    {
      id: "gpt-5-6-thinking",
      name: "GPT-5.6 Sol — Thinking",
      aliases: ["gpt-5-6-sol"],
      toolCalling: false,
      supportsReasoning: true,
      supportedThinkingEfforts: ["low", "medium", "high", "xhigh", "max"],
      supportsVision: true,
    },
    {
      id: "gpt-5-6-pro",
      name: "GPT-5.6 Sol — Pro",
      toolCalling: false,
      supportsReasoning: true,
      supportsVision: true,
    },
    { id: "gpt-5.6-luna-free", name: "GPT-5.6 Luna — Free", toolCalling: false, supportsVision: true },
    {
      id: "gpt-5.6-luna-free-thinking",
      name: "GPT-5.6 Luna — Free Thinking",
      toolCalling: false,
      supportsReasoning: true,
      supportsVision: true,
    },
    { id: "gpt-5-5-instant", name: "GPT-5.5 — Instant", toolCalling: false, supportsVision: true },
    {
      id: "gpt-5-5-thinking",
      name: "GPT-5.5 — Thinking",
      aliases: ["gpt-5-5"],
      toolCalling: false,
      supportsReasoning: true,
      supportedThinkingEfforts: ["low", "medium", "high", "xhigh", "max"],
      supportsVision: true,
    },
    {
      id: "gpt-5-5-pro",
      name: "GPT-5.5 — Pro",
      toolCalling: false,
      supportsReasoning: true,
      supportsVision: true,
    },
  ],
};
