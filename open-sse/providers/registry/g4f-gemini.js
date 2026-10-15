export default {
  id: "g4f-gemini",
  priority: 50,
  alias: "g4fgem",
  display: {
    name: "G4f Gemini",
    icon: "smart_toy",
    color: "#7C3AED",
    textIcon: "GG",
    website: "https://g4f.dev",
  },
  category: "apikey",
  authType: "optional",
  noAuth: true,
  transport: {
    baseUrl: "https://g4f.space/api/gemini/v1/chat/completions",
    validateUrl: "https://g4f.space/api/gemini/v1/models",
  },
  passthroughModels: true,
  models: [
    { id: "models/gemini-2.5-flash", name: "Gemini 2.5 Flash (g4f)" },
    { id: "models/gemini-2.5-pro", name: "Gemini 2.5 Pro (g4f)" },
  ],
};

