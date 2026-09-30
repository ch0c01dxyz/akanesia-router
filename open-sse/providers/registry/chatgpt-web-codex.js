// chatgpt-web-codex — native /v1/responses Codex requests against ChatGPT web
// sessions (OmniRoute: chatgpt-web-codex). Serves only native passthrough
// Codex calls (thread_id/turn_id verified); the turn is driven through a
// browser session and therefore needs a cookie credential bundle.
// Note: OmniRoute marks this provider reasoningTransport: "opaque" and
// forceStream: true; both are carried over under transport (9router placement,
// as in registry/chatgpt-web.js and registry/codex.js).
export default {
  id: "chatgpt-web-codex",
  alias: "cgpt-codex",
  display: {
    name: "ChatGPT Web (Codex)",
    icon: "terminal",
    color: "#10A37F",
    textIcon: "CGX",
    website: "https://chatgpt.com/",
    notice: {
      text: "Paste the JSON credential bundle: a ChatGPT browser Cookie or a verified browser storage state plus the runtime key. Only native /v1/responses Codex requests with a verified thread_id/turn_id are accepted.",
      signupUrl: "https://chatgpt.com/",
    },
  },
  category: "webCookie",
  authType: "cookie",
  authModes: ["cookie"],
  transport: {
    baseUrl: "https://chatgpt.com",
    format: "openai-responses",
    authHeader: "cookie",
    reasoningTransport: "opaque",
    forceStream: true,
  },
  models: [
    {
      id: "luna",
      name: "ChatGPT Web — Luna",
      targetFormat: "openai-responses",
      toolCalling: true,
      supportsReasoning: true,
      supportsVision: true,
      supportsXHighEffort: true,
    },
    {
      id: "think",
      name: "ChatGPT Web — Think",
      targetFormat: "openai-responses",
      toolCalling: true,
      supportsReasoning: true,
      supportsVision: true,
      supportsXHighEffort: true,
    },
    {
      id: "instant",
      name: "ChatGPT Web — Instant",
      targetFormat: "openai-responses",
      toolCalling: true,
      supportsReasoning: true,
      supportsVision: true,
      supportsXHighEffort: true,
    },
    {
      id: "medium",
      name: "ChatGPT Web — Medium",
      targetFormat: "openai-responses",
      toolCalling: true,
      supportsReasoning: true,
      supportsVision: true,
      supportsXHighEffort: true,
    },
    {
      id: "high",
      name: "ChatGPT Web — High",
      targetFormat: "openai-responses",
      toolCalling: true,
      supportsReasoning: true,
      supportsVision: true,
      supportsXHighEffort: true,
    },
    {
      id: "extra-high",
      name: "ChatGPT Web — Extra High",
      targetFormat: "openai-responses",
      toolCalling: true,
      supportsReasoning: true,
      supportsVision: true,
      supportsXHighEffort: true,
    },
    {
      id: "pro",
      name: "ChatGPT Web — Pro",
      targetFormat: "openai-responses",
      toolCalling: true,
      supportsReasoning: true,
      supportsVision: true,
      supportsXHighEffort: true,
    },
  ],
};
