export default {
  id: "aihorde",
  priority: 120,
  alias: "aihorde",
  display: {
    name: "Aihorde",
    icon: "smart_toy",
    color: "#D97706",
    textIcon: "AI",
  },
  category: "freeTier",
  authType: "apikey",
  transport: {
    baseUrl: "https://oai.aihorde.net/v1/chat/completions",
    validateUrl: "https://oai.aihorde.net/v1/models",
  },
  passthroughModels: true,
  models: [
    {
      id: "aphrodite/TheDrummer/Cydonia-24B-v4.3",
      name: "Cydonia 24B (AI Horde)",
      contextLength: 32768,
      toolCalling: false,
      unsupportedParams: ["tools","tool_choice","parallel_tool_calls"],
    },
    {
      id: "aphrodite/TheDrummer/Skyfall-31B-v4.2",
      name: "Skyfall 31B (AI Horde)",
      contextLength: 32768,
      toolCalling: false,
      unsupportedParams: ["tools","tool_choice","parallel_tool_calls"],
    },
    {
      id: "google/gemma-4-31b",
      name: "Gemma 4 31B (AI Horde)",
      contextLength: 32768,
      toolCalling: false,
      unsupportedParams: ["tools","tool_choice","parallel_tool_calls"],
    },
  ],
};

