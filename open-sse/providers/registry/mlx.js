export default {
  id: "mlx-gemma",
  priority: 50,
  alias: "mlx-gemma",
  display: {
    name: "Mlx Gemma",
    icon: "smart_toy",
    color: "#0D9488",
    textIcon: "MG",
    website: "https://ml-explore.github.io/mlx",
  },
  category: "apikey",
  authType: "apikey",
  transport: {
    baseUrl: "http://localhost:11435/v1",
    validateUrl: "http://localhost:11435/v1/models",
  },
  models: [
    {
      id: "mlx-community/gemma-4-26B-A4B-it-qat-q4_0-mlx-aligned",
      name: "Gemma 4 26B A4B IT-QAT (MLX)",
      toolCalling: true,
      supportsVision: false,
      supportsReasoning: false,
      contextLength: 8192,
      maxOutputTokens: 8192,
    },
  ],
};

