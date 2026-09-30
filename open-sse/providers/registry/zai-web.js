// zai-web — Z.ai (chat.z.ai, Zhipu AI) free consumer web chat (OmniRoute: zai-web).
// Distinct from the API-key providers on api.z.ai. The consumer frontend stores a
// Bearer JWT in localStorage and requires a browser-issued CAPTCHA proof for chat
// completions. The browser transport is unavailable in 9router, so the executor
// only serves the direct signed-API path (requests carrying a fresh
// captcha_verify_param).
export default {
  id: "zai-web",
  alias: "zw",
  display: {
    name: "Z.ai Web",
    icon: "chat",
    color: "#7C3AED",
    textIcon: "ZA",
    website: "https://chat.z.ai",
    notice: {
      text: 'Paste the "token" value from chat.z.ai Local Storage as the credential. 9router has no browser backend, so each request must also carry a fresh captcha_verify_param (a short-lived CAPTCHA proof the site issues).',
    },
  },
  category: "free",
  authType: "apikey",
  authModes: ["apikey"],
  transport: {
    baseUrl: "https://chat.z.ai",
    format: "openai",
    authHeader: "bearer",
  },
  // Z.ai's visible "Tools" switch enables its internal VLM/MCP tools. It does
  // not accept caller-supplied OpenAI `tools`, which remains disabled here.
  models: [
    {
      id: "glm-5.3-flash",
      name: "GLM-5.3-Flash",
      toolCalling: false,
      supportsReasoning: true,
      supportedThinkingEfforts: ["low", "high", "max"],
      supportsVision: true,
    },
    {
      id: "glm-5.3",
      name: "GLM-5.3",
      toolCalling: false,
      supportsReasoning: true,
      supportedThinkingEfforts: ["low", "high", "max"],
    },
    {
      id: "glm-5.2",
      name: "GLM-5.2",
      toolCalling: false,
      supportsReasoning: true,
      supportedThinkingEfforts: ["high", "max"],
    },
  ],
};
