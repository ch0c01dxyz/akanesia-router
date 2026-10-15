export default {
  id: "g4f-ollama",
  priority: 50,
  alias: "g4foll",
  display: {
    name: "G4f Ollama",
    icon: "smart_toy",
    color: "#16A34A",
    textIcon: "GO",
    website: "https://g4f.dev",
  },
  category: "apikey",
  authType: "optional",
  noAuth: true,
  transport: {
    baseUrl: "https://g4f.space/api/ollama/v1/chat/completions",
    validateUrl: "https://g4f.space/api/ollama/v1/models",
  },
  passthroughModels: true,
  models: [
    { id: "gemma3:4b", name: "Gemma 3 4B (g4f/Ollama)" },
  ],
};

