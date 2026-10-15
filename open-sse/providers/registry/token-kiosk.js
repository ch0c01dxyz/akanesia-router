export default {
  id: "token-kiosk",
  priority: 50,
  alias: "tk",
  display: {
    name: "Token Kiosk",
    icon: "smart_toy",
    color: "#EA580C",
    textIcon: "TK",
    website: "https://token-kiosk.gaib.ai/docs",
  },
  category: "apikey",
  authType: "apikey",
  transport: {
    baseUrl: "https://agent-router.gaib.ai/v1/chat/completions",
    validateUrl: "https://agent-router.gaib.ai/v1/models",
  },
  models: [
    {
      id: "claude-3-5-sonnet",
      name: "Claude 3.5 Sonnet (Token Kiosk)",
      contextLength: 200000,
      toolCalling: true,
      supportsVision: true,
    },
    {
      id: "deepseek-v3",
      name: "DeepSeek V3 (Token Kiosk)",
      contextLength: 64000,
      toolCalling: true,
    },
    {
      id: "deepseek-r1",
      name: "DeepSeek R1 (Token Kiosk)",
      contextLength: 64000,
      toolCalling: true,
      supportsReasoning: true,
    },
    {
      id: "kimi-k1.5",
      name: "Kimi K1.5 (Token Kiosk)",
      contextLength: 128000,
      toolCalling: true,
    },
    {
      id: "minimax-m6",
      name: "MiniMax M6 (Token Kiosk)",
      contextLength: 128000,
      toolCalling: true,
    },
  ],
};

