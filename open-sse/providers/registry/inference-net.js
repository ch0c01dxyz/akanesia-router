export default {
  id: "inference-net",
  priority: 120,
  alias: "inet",
  display: {
    name: "Inference Net",
    icon: "smart_toy",
    color: "#7C3AED",
    textIcon: "IN",
    website: "https://inference.net",
    notice: {
      apiKeyUrl: "https://inference.net/dashboard",
    },
  },
  category: "freeTier",
  authType: "apikey",
  transport: {
    baseUrl: "https://api.inference.net/v1/chat/completions",
    validateUrl: "https://api.inference.net/v1/models",
  },
  models: [
    { id: "meta-llama/Llama-3.3-70B-Instruct", name: "meta-llama/Llama-3.3-70B-Instruct" },
    { id: "deepseek-ai/DeepSeek-R1", name: "deepseek-ai/DeepSeek-R1" },
    { id: "Qwen/Qwen2.5-72B-Instruct", name: "Qwen/Qwen2.5-72B-Instruct" },
  ],
};

