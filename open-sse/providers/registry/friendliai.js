export default {
  id: "friendliai",
  priority: 120,
  alias: "friendli",
  display: {
    name: "Friendliai",
    icon: "smart_toy",
    color: "#0D9488",
    textIcon: "FR",
  },
  category: "freeTier",
  authType: "apikey",
  transport: {
    baseUrl: "https://api.friendli.ai/serverless/v1/chat/completions",
    validateUrl: "https://api.friendli.ai/serverless/v1/models",
  },
  models: [
    { id: "meta-llama-3.1-70b-instruct", name: "meta-llama-3.1-70b-instruct" },
    { id: "meta-llama-3.1-8b-instruct", name: "meta-llama-3.1-8b-instruct" },
  ],
};

