export default {
  id: "llm-kiwi",
  priority: 50,
  alias: "llmkiwi",
  display: {
    name: "Llm Kiwi",
    icon: "smart_toy",
    color: "#C026D3",
    textIcon: "LK",
  },
  category: "apikey",
  authType: "apikey",
  transport: {
    baseUrl: "https://api.llm.kiwi/v1/chat/completions",
    validateUrl: "https://api.llm.kiwi/v1/models",
  },
  passthroughModels: true,
  models: [
    { id: "auto", name: "Auto" },
    { id: "hrLLM", name: "hrLLM" },
  ],
};

