export default {
  id: "demonroute",
  priority: 120,
  alias: "demonroute",
  display: {
    name: "Demon Route",
    color: "#6366F1",
    textIcon: "DR",
  },
  category: "apikey",
  authType: "apikey",
  transport: {
    baseUrl: "https://api.demonroute.com/v1/chat/completions",
    // /v1/models is key-gated, so it works as a validator.
    validateUrl: "https://api.demonroute.com/v1/models",
    // The provider recommends at least 120s; honored by DefaultExecutor via
    // BaseExecutor as the connect timeout (time to first response headers),
    // not as a cap on total stream duration.
    timeoutMs: 120000,
  },
  // Model channel ids are exact, case-sensitive vendor/model strings.
  models: [
    { id: "dphn/Dolphin3.0-Llama3.1-8B", name: "Dolphin 3.0 Llama 3.1 8B" },
    { id: "dphn/Dolphin-Mistral-24B-Venice-Edition", name: "Dolphin Mistral 24B Venice" },
    { id: "TheDrummer/Artemis-31B-v1.2", name: "Artemis 31B v1.2" },
    { id: "TheDrummer/Cydonia-24B-v4.3", name: "Cydonia 24B v4.3" },
    { id: "huihui-ai/Huihui-Qwen3.6-35B-A3B-abliterated", name: "Huihui Qwen 3.6 35B A3B Abliterated" },
    { id: "huihui-ai/Huihui-gemma-4-31B-it-abliterated-v2", name: "Huihui Gemma 4 31B Abliterated v2" },
    { id: "dphn/dolphin-2.9.3-mistral-nemo-12b", name: "Dolphin 2.9.3 Mistral Nemo 12B" },
  ],
  modelsFetcher: { url: "https://api.demonroute.com/v1/models", type: "openai" },
  passthroughModels: true,
};
