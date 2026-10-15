export default {
  id: "g4f-groq",
  priority: 50,
  alias: "g4fgroq",
  display: {
    name: "G4f Groq",
    icon: "smart_toy",
    color: "#EA580C",
    textIcon: "GG",
    website: "https://g4f.space",
  },
  category: "apikey",
  authType: "optional",
  noAuth: true,
  transport: {
    baseUrl: "https://g4f.space/api/groq/v1/chat/completions",
    validateUrl: "https://g4f.space/api/groq/v1/models",
  },
  passthroughModels: true,
  models: [
    { id: "llama-3.3-70b-versatile", name: "Llama 3.3 70B (g4f/Groq)" },
    { id: "llama-3.1-8b-instant", name: "Llama 3.1 8B Instant (g4f/Groq)" },
  ],
};

