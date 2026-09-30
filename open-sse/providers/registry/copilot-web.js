// copilot-web — Microsoft Copilot Web session provider (OmniRoute: copilot-web).
// Routes requests through copilot.microsoft.com's WebSocket API
// (wss://copilot.microsoft.com/c/api/chat?api-version=2), translating between
// OpenAI chat completions format and Copilot's proprietary WebSocket event
// protocol. Auth: access_token from copilot.microsoft.com (DevTools or HAR
// export); anonymous access is supported with limited models.
export default {
  id: "copilot-web",
  alias: "copilot-web",
  uiAlias: "copilot-web",
  display: {
    name: "Copilot Web",
    icon: "smart_toy",
    color: "#0F6CBD",
    textIcon: "CP",
    website: "https://copilot.microsoft.com",
    notice: {
      text: "Paste your copilot.microsoft.com access_token (from DevTools or a HAR export — the full cookie string also works) as the API key. Anonymous access works with limited models.",
      signupUrl: "https://copilot.microsoft.com",
    },
  },
  category: "webCookie",
  authType: "cookie",
  authModes: ["cookie"],
  transport: {
    baseUrl: "https://copilot.microsoft.com",
    format: "openai",
    authHeader: "cookie",
  },
  models: [
    { id: "copilot-pro", name: "Copilot Pro (web)", toolCalling: false },
    { id: "gpt-4-turbo", name: "GPT-4 Turbo (via Copilot)", toolCalling: false },
    { id: "gpt-4", name: "GPT-4 (via Copilot)", toolCalling: false },
  ],
};
