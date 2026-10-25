import { CLAUDE_CLI_SPOOF_HEADERS } from "../shared.js";

export default {
  id: "agentrouter",
  priority: 120,
  alias: "agentrouter",
  display: {
    name: "Agentrouter",
    icon: "smart_toy",
    color: "#4F46E5",
    textIcon: "AG",
    website: "https://agentrouter.org",
    notice: {
      apiKeyUrl: "https://agentrouter.org/console/token",
    },
  },
  category: "freeTier",
  authType: "apikey",
  transport: {
    baseUrl: "https://agentrouter.org/v1/messages",
    format: "claude",
    // Agentrouter gates on client identity: bare API clients get
    // "unauthorized client detected" even with a valid key. The full Claude
    // CLI fingerprint (verified live 2026-10-25: with these headers the gate
    // passes and a bad key yields the normal invalid-token 401 instead).
    headers: { ...CLAUDE_CLI_SPOOF_HEADERS },
    auth: { combined: true, header: "x-api-key", scheme: "raw" },
  },
  passthroughModels: true,
  models: [
    {
      id: "claude-opus-4-8",
      name: "Claude Opus 4.8",
      supportsReasoning: true,
      supportedThinkingEfforts: ["low","medium","high","xhigh","max"],
    },
    {
      id: "claude-opus-5",
      name: "Claude Opus 5",
      supportsReasoning: true,
      supportedThinkingEfforts: ["low","medium","high","xhigh","max"],
    },
    { id: "gpt-5.6-sol", name: "GPT-5.6 Sol" },
  ],
};

