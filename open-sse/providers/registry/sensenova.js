export default {
  id: "sensenova",
  priority: 120,
  alias: "sensenova",
  display: {
    name: "Sensenova",
    icon: "smart_toy",
    color: "#16A34A",
    textIcon: "SE",
    website: "https://www.sensenova.cn",
    notice: {
      apiKeyUrl: "https://platform.sensenova.cn",
    },
  },
  category: "freeTier",
  authType: "apikey",
  transport: {
    baseUrl: "https://token.sensenova.cn/v1/chat/completions",
    validateUrl: "https://token.sensenova.cn/v1/models",
  },
  models: [
    {
      id: "sensenova-6.7-flash-lite",
      name: "SenseNova 6.7 Flash-Lite",
      contextLength: 262144,
      maxOutputTokens: 65536,
      supportsVision: true,
      toolCalling: true,
    },
    {
      id: "deepseek-v4-flash",
      name: "DeepSeek V4 Flash",
      contextLength: 1048576,
      maxOutputTokens: 65536,
      supportsReasoning: true,
      supportedThinkingEfforts: ["none","low","medium","high","xhigh"],
      supportsXHighEffort: true,
      interleavedField: "reasoning_content",
    },
    {
      id: "glm-5.2",
      name: "GLM 5.2",
      contextLength: 1048576,
      maxOutputTokens: 65536,
      supportsReasoning: true,
      interleavedField: "reasoning_content",
    },
  ],
};

