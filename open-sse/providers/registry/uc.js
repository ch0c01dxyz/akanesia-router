// uc — UC (uncensored.com) un-metered "persona" chat via WebSocket (OmniRoute: uc).
// Custom executor: open-sse/executors/uc.js — mints a 60s Clerk __session JWT from the
// durable __client cookie (stored in providerSpecificData by the email-login bootstrap),
// drives the persona socket wss://internal-6.pubyar.com/ws/{uid}?token={jwt}, and
// translates persona frames to OpenAI SSE. No API key on this path.
export default {
  id: "uc",
  alias: "ucn",
  uiAlias: "ucn",
  display: {
    name: "UC",
    icon: "forum",
    color: "#8B5CF6",
    textIcon: "UC",
    website: "https://uncensored.com",
    notice: {
      signupUrl: "https://uncensored.com",
      text: "No API key — the UC connection is bootstrapped by the browserless email-code login, which stores the Clerk __client cookie, session id and uid in provider-specific data.",
    },
  },
  category: "free",
  authType: "none",
  authModes: ["none"],
  transport: {
    baseUrl: "https://internal-6.pubyar.com",
    format: "openai",
    authHeader: "none",
  },
  defaultContextLength: 128000,
  models: [
    { id: "claude-opus-45", name: "Claude Opus 4.5", contextLength: 200000, toolCalling: true, maxOutputTokens: 64000, supportsVision: true },
    { id: "claude-opus-46", name: "Claude Opus 4.6", contextLength: 1000000, toolCalling: true, maxOutputTokens: 128000, supportsVision: true },
    { id: "claude-opus-46-v2", name: "Claude Opus 4.6 (v2)", contextLength: 1000000, toolCalling: true, maxOutputTokens: 128000, supportsVision: true },
    { id: "claude-opus-47", name: "Claude Opus 4.7", contextLength: 1000000, toolCalling: true, maxOutputTokens: 128000, supportsVision: true },
    { id: "claude-opus-47-v2", name: "Claude Opus 4.7 (v2)", contextLength: 1000000, toolCalling: true, maxOutputTokens: 128000, supportsVision: true },
    { id: "claude-opus-48-uncensored", name: "Claude Opus 4.8 (Uncensored)", contextLength: 1000000, toolCalling: true, maxOutputTokens: 128000, supportsVision: true },
    { id: "deepseek-r1", name: "DeepSeek R1", contextLength: 163840, toolCalling: true, maxOutputTokens: 16000, supportsReasoning: true },
    { id: "glm-5.1", name: "GLM 5.1", contextLength: 202752, toolCalling: true, maxOutputTokens: 131072 },
    { id: "gpt-5.5", name: "GPT-5.5", contextLength: 1050000, toolCalling: true, maxOutputTokens: 128000, supportsVision: true },
    { id: "gemini-3-flash", name: "Gemini 3 Flash", contextLength: 1048576, toolCalling: true, maxOutputTokens: 65536, supportsVision: true },
    { id: "gemini-31-uncensored", name: "Gemini 3.1 (Uncensored)", contextLength: 1048576, toolCalling: true, maxOutputTokens: 65536, supportsVision: true },
    { id: "gemini-emotional", name: "Gemini (Emotional)", contextLength: 1048576, toolCalling: true, maxOutputTokens: 65536, supportsVision: true },
    { id: "gemini-3-uncensored", name: "Gemini 3 (Uncensored)", contextLength: 1048576, toolCalling: true, maxOutputTokens: 65536, supportsVision: true },
    { id: "grok-4", name: "Grok 4", contextLength: 1000000, toolCalling: true, supportsVision: true },
    { id: "grok-4-20", name: "Grok 4.20", contextLength: 2000000, toolCalling: true, supportsVision: true },
    { id: "grok-4-3", name: "Grok 4.3", contextLength: 1000000, toolCalling: true, supportsVision: true },
    { id: "kimi-k2-thinking", name: "Kimi K2 Thinking", contextLength: 262144, toolCalling: true, maxOutputTokens: 262144, supportsReasoning: true },
    { id: "kimi-k2.5", name: "Kimi K2.5", contextLength: 262144, toolCalling: true, maxOutputTokens: 262144, supportsVision: true },
    { id: "minimax-m2-her", name: "MiniMax M2 (Her)", contextLength: 204800, toolCalling: true, maxOutputTokens: 131072 },
  ],
};
