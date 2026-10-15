export default {
  id: "wandb",
  priority: 50,
  alias: "wandb",
  display: {
    name: "Wandb",
    icon: "smart_toy",
    color: "#0891B2",
    textIcon: "WA",
    website: "https://wandb.ai",
    notice: {
      apiKeyUrl: "https://wandb.ai/authorize",
    },
  },
  category: "apikey",
  authType: "apikey",
  transport: {
    baseUrl: "https://api.inference.wandb.ai/v1/chat/completions",
    validateUrl: "https://api.inference.wandb.ai/v1/models",
  },
  models: [
    { id: "openai/gpt-oss-120b", name: "openai/gpt-oss-120b" },
    { id: "Qwen/Qwen3-Coder-480B-A35B-Instruct", name: "Qwen/Qwen3-Coder-480B-A35B-Instruct" },
    { id: "deepseek-ai/DeepSeek-V3.1", name: "deepseek-ai/DeepSeek-V3.1" },
  ],
};

