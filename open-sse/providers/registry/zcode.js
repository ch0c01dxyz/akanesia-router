// zcode — local ZCode app-server backend (OmniRoute: zcode). No auth; the
// user's local ZCode profile (`builtin:zai-coding-plan`) owns the Z.ai
// credential. Spawns the local zcode app-server over stdio.
export default {
  id: "zcode",
  alias: "zc",
  uiAlias: "zc",
  display: {
    name: "ZCode",
    icon: "terminal",
    color: "#8B5CF6",
    textIcon: "ZC",
    website: "https://z.ai",
    notice: {
      text: "Requires the local ZCode app-server (`zcode` CLI or the bundled zcode-server runtime) installed and logged in. No API key needed.",
    },
  },
  category: "free",
  authType: "none",
  noAuth: true,
  authModes: ["none"],
  transport: {
    baseUrl: "zcode://app-server/stdio",
    format: "openai",
  },
  models: [
    { id: "glm-5.3-flash", name: "GLM 5.3 Flash", contextLength: 1000000, maxOutputTokens: 131072, toolCalling: true, supportsReasoning: true, supportedThinkingEfforts: [], supportsVision: true },
    { id: "glm-5.3", name: "GLM 5.3", contextLength: 1000000, maxOutputTokens: 131072, toolCalling: true, supportsReasoning: true, supportedThinkingEfforts: [] },
    { id: "glm-5.3-max", name: "GLM 5.3 Max", contextLength: 1000000, maxOutputTokens: 131072, toolCalling: true, supportsReasoning: true, supportedThinkingEfforts: [] },
    { id: "glm-5.2", name: "GLM 5.2", contextLength: 1000000, maxOutputTokens: 131072, toolCalling: true, supportsReasoning: true, supportedThinkingEfforts: [] },
    { id: "glm-5.1", name: "GLM 5.1", contextLength: 204800, maxOutputTokens: 131072, toolCalling: true, supportsReasoning: true, supportedThinkingEfforts: [] },
    { id: "glm-5", name: "GLM 5", contextLength: 200000, maxOutputTokens: 131072, toolCalling: true, supportsReasoning: true, supportedThinkingEfforts: [] },
    { id: "glm-5-turbo", name: "GLM 5 Turbo", contextLength: 200000, maxOutputTokens: 131072, toolCalling: true, supportsReasoning: true, supportedThinkingEfforts: [] },
    { id: "glm-4.7-flash", name: "GLM 4.7 Flash", contextLength: 200000, maxOutputTokens: 131072, toolCalling: true, supportsReasoning: true, supportedThinkingEfforts: [] },
    { id: "glm-4.7", name: "GLM 4.7", contextLength: 200000, maxOutputTokens: 131072, toolCalling: true, supportsReasoning: true, supportedThinkingEfforts: [] },
    { id: "glm-4.6v", name: "GLM 4.6V (Vision)", contextLength: 128000, maxOutputTokens: 32768, toolCalling: true, supportsReasoning: true, supportedThinkingEfforts: [], supportsVision: true },
    { id: "glm-4.6", name: "GLM 4.6", contextLength: 200000, maxOutputTokens: 32768, toolCalling: true, supportsReasoning: true, supportedThinkingEfforts: [] },
    { id: "glm-4.5v", name: "GLM 4.5V (Vision)", contextLength: 16000, maxOutputTokens: 32768, toolCalling: true, supportsReasoning: true, supportedThinkingEfforts: [], supportsVision: true },
    { id: "glm-4.5", name: "GLM 4.5", contextLength: 128000, maxOutputTokens: 32768, toolCalling: true, supportsReasoning: true, supportedThinkingEfforts: [] },
    { id: "glm-4.5-air", name: "GLM 4.5 Air", contextLength: 128000, maxOutputTokens: 32768, toolCalling: true, supportsReasoning: true, supportedThinkingEfforts: [] },
  ],
};
