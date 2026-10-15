export default {
  id: "wafer",
  priority: 50,
  alias: "wafer",
  display: {
    name: "Wafer",
    icon: "smart_toy",
    color: "#DC2626",
    textIcon: "WA",
    website: "https://wafer.ai",
  },
  category: "apikey",
  authType: "apikey",
  transport: {
    baseUrl: "https://pass.wafer.ai/v1/messages",
    format: "claude",
    headers: {
      "Anthropic-Version": "2023-06-01",
    },
  },
  models: [
    { id: "DeepSeek-V4-Pro", name: "DeepSeek V4 Pro" },
    { id: "MiniMax-M2.7", name: "MiniMax M2.7" },
    { id: "Qwen3.5-397B-A17B", name: "Qwen3.5 397B A17B" },
    { id: "GLM-5.1", name: "GLM 5.1" },
  ],
};

