export default {
  id: "meta-llama",
  priority: 50,
  alias: "meta",
  display: {
    name: "Meta Llama",
    icon: "smart_toy",
    color: "#EA580C",
    textIcon: "ML",
    website: "https://www.llama.com",
    notice: { apiKeyUrl: "https://llama.developer.meta.com/" },
  },
  category: "apikey",
  authType: "apikey",
  transport: {
    baseUrl: "https://api.llama.com/compat/v1/chat/completions",
    validateUrl: "https://api.llama.com/compat/v1/models",
  },
  models: [
    { id: "Llama-4-Maverick-17B-128E-Instruct-FP8", name: "Llama-4-Maverick-17B-128E-Instruct-FP8" },
    { id: "Llama-4-Scout-17B-16E-Instruct-FP8", name: "Llama-4-Scout-17B-16E-Instruct-FP8" },
    { id: "Llama-3.3-70B-Instruct", name: "Llama-3.3-70B-Instruct" },
    { id: "Llama-3.3-8B-Instruct", name: "Llama-3.3-8B-Instruct" },
  ],
};

