export default {
  id: "modal",
  priority: 50,
  alias: "modal",
  display: {
    name: "Modal",
    icon: "smart_toy",
    color: "#EA580C",
    textIcon: "MO",
    website: "https://modal.com",
    notice: { apiKeyUrl: "https://modal.com/settings/tokens" },
  },
  category: "apikey",
  authType: "apikey",
  transport: {
    baseUrl: "https://api.modal.ai/v1/chat/completions",
    validateUrl: "https://api.modal.ai/v1/models",
  },
  models: [
    { id: "google/gemini-2.0-flash", name: "Gemini 2.0 Flash" },
  ],
};

