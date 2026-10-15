export default {
  id: "v0-vercel",
  priority: 50,
  alias: "v0",
  display: {
    name: "V0 Vercel",
    icon: "smart_toy",
    color: "#0891B2",
    textIcon: "VV",
    website: "https://v0.dev",
    notice: {
      apiKeyUrl: "https://v0.dev/chat/settings/keys",
    },
  },
  category: "apikey",
  authType: "apikey",
  transport: {
    baseUrl: "https://api.v0.dev/v1/chat/completions",
    validateUrl: "https://api.v0.dev/v1/models",
  },
  models: [
    { id: "v0-1.0-md", name: "v0-1.0-md" },
    { id: "v0-1.5-lg", name: "v0-1.5-lg" },
    { id: "v0-1.5-md", name: "v0-1.5-md" },
  ],
};

