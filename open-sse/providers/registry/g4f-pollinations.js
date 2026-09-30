export default {
  id: "g4f-pollinations",
  priority: 50,
  alias: "g4fpol",
  display: {
    name: "G4f Pollinations",
    icon: "smart_toy",
    color: "#0891B2",
    textIcon: "GP",
  },
  category: "apikey",
  authType: "optional",
  noAuth: true,
  transport: {
    baseUrl: "https://g4f.space/api/pollinations/v1/chat/completions",
    validateUrl: "https://g4f.space/api/pollinations/v1/models",
  },
  passthroughModels: true,
  models: [
    { id: "openai", name: "OpenAI (g4f/Pollinations)" },
    { id: "openai-fast", name: "OpenAI Fast (g4f/Pollinations)" },
  ],
};

