export default {
  id: "bytez",
  priority: 120,
  alias: "bytez",
  display: {
    name: "Bytez",
    icon: "smart_toy",
    color: "#4F46E5",
    textIcon: "BY",
  },
  category: "freeTier",
  authType: "apikey",
  transport: {
    baseUrl: "https://api.bytez.com/models/v2/openai/v1/chat/completions",
    validateUrl: "https://api.bytez.com/models/v2/openai/v1/models",
  },
  models: [
    { id: "meta-llama/Llama-3.3-70B-Instruct", name: "meta-llama/Llama-3.3-70B-Instruct" },
    { id: "mistralai/Mistral-7B-Instruct-v0.3", name: "mistralai/Mistral-7B-Instruct-v0.3" },
    { id: "Qwen/Qwen2.5-72B-Instruct", name: "Qwen/Qwen2.5-72B-Instruct" },
  ],
};

