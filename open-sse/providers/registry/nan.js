export default {
  id: "nan",
  priority: 120,
  alias: "nan",
  display: {
    name: "NaN.Builders",
    color: "#6366F1",
    textIcon: "NA",
  },
  category: "apikey",
  authType: "apikey",
  transport: {
    baseUrl: "https://api.nan.builders/v1/chat/completions",
    // /v1/models is key-gated, so it works as a validator.
    validateUrl: "https://api.nan.builders/v1/models",
  },
  // Chat-only seed. The source declares NO passthroughModels (only these 8
  // ids), so none is declared here either — do not add it without a decision.
  models: [
    { id: "deepseek-v4-flash", name: "DeepSeek V4 Flash" },
    { id: "mimo-v2.5", name: "MiMo V2.5" },
    { id: "mimo-v2.6-flash", name: "MiMo V2.6 Flash" },
    { id: "qwen3.8-flash", name: "Qwen3.8 Flash" },
    { id: "qwen3.6", name: "Qwen3.6" },
    { id: "glm5.3", name: "GLM 5.3" },
    { id: "glm5.3-flash", name: "GLM 5.3 Flash" },
    { id: "gemma4", name: "Gemma 4" },
  ],
  modelsFetcher: { url: "https://api.nan.builders/v1/models", type: "openai" },
};
