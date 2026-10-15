export default {
  id: "uncloseai",
  priority: 120,
  alias: "unc",
  display: {
    name: "Uncloseai",
    icon: "smart_toy",
    color: "#2563EB",
    textIcon: "UN",
    website: "https://uncloseai.com",
  },
  category: "freeTier",
  authType: "optional",
  noAuth: true,
  transport: {
    baseUrl: "https://hermes.ai.unturf.com/v1/chat/completions",
    validateUrl: "https://hermes.ai.unturf.com/v1/models",
  },
  models: [
    {
      id: "Lorbus/Qwen3.6-27B-int4-AutoRound",
      name: "Qwen3.6 27B int4 AutoRound (🆓 Free)",
      contextLength: 65536,
    },
  ],
};

