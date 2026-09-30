// maxai — MaxAI web app (chat.maxai.co / api.maxai.me) as an OpenAI-compatible
// provider (OmniRoute: maxai). Reproduces the web app's signed request to
// /gpt/cwc/chat: per-request X-Authorization signature + Bearer access token.
// The access token is minted/refreshed out-of-band by a browser-mint flow; the
// executor consumes the stored credential (accessToken + deviceId + userId).
export default {
  id: "maxai",
  alias: "mx",
  category: "webCookie",
  authType: "apikey",
  authModes: ["apikey"],
  display: {
    name: "MaxAI",
    icon: "auto_awesome",
    color: "#7C3AED",
    textIcon: "MX",
    website: "https://chat.maxai.co",
    notice: {
      text: "Paste your MaxAI access token as the API key. The device id and user id that minted it ride in providerSpecificData (maxaiDeviceId / maxaiUserId); the token is refreshed out-of-band by the browser-mint flow.",
    },
  },
  transport: {
    baseUrl: "https://api.maxai.me",
    format: "openai",
    authHeader: "bearer",
  },
  models: [
    // OmniRoute MAXAI_REGISTRY_MODELS (executors/maxai/catalog.ts): all 13 chat
    // models are paid. toolCalling is the prompted <tool> protocol (no native API).
    { id: "gpt-5.6-luna", name: "GPT-5.6 Luna", contextLength: 1050000, toolCalling: true, supportsVision: true },
    { id: "claude-haiku-4-5", name: "Claude Haiku 4.5", contextLength: 200000, toolCalling: true, supportsVision: true },
    { id: "gemini-3-1-flash-lite", name: "Gemini 3.1 Flash Lite", contextLength: 1000000, toolCalling: true, supportsVision: true },
    { id: "grok-4-1-fast-non-reasoning", name: "Grok 4.1 Fast", contextLength: 2000000, toolCalling: true },
    { id: "llama-3.3-70b", name: "Llama 3.3 70B", contextLength: 128000, toolCalling: true },
    { id: "deepseek-v3.2", name: "DeepSeek V3.2", contextLength: 128000, toolCalling: true },
    { id: "gpt-5.6", name: "GPT-5.6", contextLength: 1050000, toolCalling: true, supportsVision: true },
    { id: "claude-5-sonnet", name: "Claude 5 Sonnet", contextLength: 1000000, toolCalling: true },
    { id: "grok-4-1-fast-reasoning", name: "Grok 4.1 Fast (Reasoning)", contextLength: 2000000, toolCalling: true, supportsReasoning: true },
    { id: "gpt-5.6-thinking", name: "GPT-5.6 Thinking", contextLength: 1050000, toolCalling: true, supportsReasoning: true, supportsVision: true },
    { id: "gemini-3.1-pro-preview", name: "Gemini 3.1 Pro Preview", contextLength: 1000000, toolCalling: true, supportsReasoning: true, supportsVision: true },
    { id: "grok-4.5", name: "Grok 4.5", contextLength: 500000, toolCalling: true, supportsReasoning: true },
    { id: "deepseek-r1", name: "DeepSeek R1", contextLength: 128000, toolCalling: true, supportsReasoning: true },
  ],
};
