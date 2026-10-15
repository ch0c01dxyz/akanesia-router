export default {
  id: "ovhcloud",
  priority: 120,
  alias: "ovh",
  display: {
    name: "Ovhcloud",
    icon: "smart_toy",
    color: "#5B5FEF",
    textIcon: "OV",
    website: "https://www.ovhcloud.com/en/public-cloud/ai-endpoints/",
  },
  category: "freeTier",
  authType: "optional",
  noAuth: true,
  transport: {
    baseUrl: "https://oai.endpoints.kepler.ai.cloud.ovh.net/v1/chat/completions",
    validateUrl: "https://oai.endpoints.kepler.ai.cloud.ovh.net/v1/models",
  },
  models: [
    { id: "Meta-Llama-3_3-70B-Instruct", name: "Meta-Llama-3_3-70B-Instruct" },
    { id: "Qwen2.5-Coder-32B-Instruct", name: "Qwen2.5-Coder-32B-Instruct" },
    { id: "Mistral-Small-3.2-24B-Instruct-2506", name: "Mistral-Small-3.2-24B-Instruct-2506" },
  ],
};

