export default {
  id: "nlpcloud",
  priority: 120,
  alias: "nlpc",
  display: {
    name: "Nlpcloud",
    icon: "smart_toy",
    color: "#059669",
    textIcon: "NL",
  },
  category: "freeTier",
  authType: "apikey",
  transport: {
    baseUrl: "https://api.nlpcloud.io/v1/gpu",
  },
  models: [
    {
      id: "chatdolphin",
      name: "ChatDolphin",
      contextLength: 8192,
    },
    {
      id: "dolphin",
      name: "Dolphin",
      contextLength: 16384,
    },
    { id: "finetuned-llama-3-70b", name: "Fine-tuned LLaMA 3.3 70B" },
    { id: "llama-3-1-405b", name: "LLaMA 3.1 405B" },
    { id: "llama-3-8b-instruct", name: "Llama 3 8B" },
  ],
};

