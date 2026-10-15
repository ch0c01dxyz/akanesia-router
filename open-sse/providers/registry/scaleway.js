export default {
  id: "scaleway",
  priority: 120,
  alias: "scw",
  display: {
    name: "Scaleway",
    icon: "smart_toy",
    color: "#7C3AED",
    textIcon: "SC",
    website: "https://www.scaleway.com",
    notice: {
      apiKeyUrl: "https://console.scaleway.com/iam/api-keys",
    },
  },
  category: "freeTier",
  authType: "apikey",
  transport: {
    baseUrl: "https://api.scaleway.ai/v1/chat/completions",
    validateUrl: "https://api.scaleway.ai/v1/models",
  },
  models: [
    { id: "qwen3-235b-a22b-instruct-2507", name: "Qwen3 235B A22B (1M free tok 🆓)" },
    { id: "llama-3.1-70b-instruct", name: "Llama 3.1 70B (🆓 EU)" },
    { id: "llama-3.1-8b-instruct", name: "Llama 3.1 8B (🆓 EU)" },
    { id: "mistral-small-3.2-24b-instruct-2506", name: "Mistral Small 3.2 (🆓 EU)" },
    { id: "deepseek-v3-0324", name: "DeepSeek V3 (🆓 EU)" },
    { id: "gpt-oss-120b", name: "GPT-OSS 120B (🆓 EU)" },
  ],
};

