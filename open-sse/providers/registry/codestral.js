export default {
  id: "codestral",
  priority: 50,
  alias: "codestral",
  display: {
    name: "Codestral",
    icon: "smart_toy",
    color: "#0D9488",
    textIcon: "CO",
  },
  category: "apikey",
  authType: "apikey",
  transport: {
    baseUrl: "https://codestral.mistral.ai/v1/chat/completions",
    validateUrl: "https://codestral.mistral.ai/v1/models",
  },
  models: [
    { id: "codestral-2508", name: "codestral-2508" },
    { id: "codestral-latest", name: "codestral-latest" },
  ],
};

