export default {
  id: "llamagate",
  priority: 50,
  alias: "llamagate",
  display: {
    name: "Llamagate",
    icon: "smart_toy",
    color: "#C026D3",
    textIcon: "LL",
  },
  category: "apikey",
  authType: "apikey",
  transport: {
    baseUrl: "https://llamagate.ai/v1/chat/completions",
    validateUrl: "https://llamagate.ai/v1/models",
  },
  models: [
    { id: "qwen2.5-coder-7b", name: "qwen2.5-coder-7b" },
    { id: "deepseek-coder-6.7b", name: "deepseek-coder-6.7b" },
    { id: "qwen3-vl-8b", name: "qwen3-vl-8b" },
  ],
};

