// clova-studio — Naver CLOVA Studio Chat Completions v3 (OmniRoute: clova-studio).
// Model goes in the URL path; wire format translated by the openai↔clova translators.
export default {
  id: "clova-studio",
  priority: 60,
  alias: "clova",
  uiAlias: "clova",
  display: {
    name: "CLOVA Studio",
    icon: "cloud",
    color: "#03C75A",
    textIcon: "CV",
    website: "https://clova.ai",
    notice: {
      apiKeyUrl: "https://www.ncloud.com/product/aiService/clovaStudio",
      text: "CLOVA Studio v3 API key (X-NCP-CLOVASTUDIO-API-KEY).",
    },
  },
  category: "apikey",
  authType: "apikey",
  transport: {
    baseUrls: ["https://clovastudio.stream.ntruss.com/v3/chat-completions"],
    format: "clova",
    authHeader: "bearer",
  },
  models: [
    { id: "HCX-007", name: "HCX-007", contextLength: 128000, maxOutputTokens: 32768, supportsReasoning: true, toolCalling: true },
    { id: "HCX-005", name: "HCX-005", contextLength: 128000, maxOutputTokens: 4096, supportsVision: true, toolCalling: true },
    { id: "HCX-DASH-002", name: "HCX-DASH-002", contextLength: 32000, maxOutputTokens: 4096, toolCalling: true },
  ],
};
