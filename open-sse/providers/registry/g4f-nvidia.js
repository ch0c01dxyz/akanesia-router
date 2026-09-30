export default {
  id: "g4f-nvidia",
  priority: 50,
  alias: "g4fnv",
  display: {
    name: "G4f Nvidia",
    icon: "smart_toy",
    color: "#059669",
    textIcon: "GN",
  },
  category: "apikey",
  authType: "optional",
  noAuth: true,
  transport: {
    baseUrl: "https://g4f.space/api/nvidia/v1/chat/completions",
    validateUrl: "https://g4f.space/api/nvidia/v1/models",
  },
  passthroughModels: true,
  models: [
    { id: "nvidia/nemotron-3-nano-30b-a3b", name: "Nemotron 3 Nano 30B (g4f/NVIDIA)" },
    { id: "z-ai/glm-5.2", name: "GLM 5.2 (g4f/NVIDIA)" },
    { id: "minimaxai/minimax-m2.7", name: "MiniMax M2.7 (g4f/NVIDIA)" },
  ],
};

