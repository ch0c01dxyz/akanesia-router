export default {
  id: "opencode",
  priority: 40,
  hasFree: true,
  alias: "oc",
  uiAlias: "oc",
  display: {
    name: "OpenCode Free",
    icon: "terminal",
    color: "#E87040",
    textIcon: "OC",
  },
  category: "free",
  noAuth: true,
  transport: {
    baseUrl: "https://opencode.ai",
    headers: {
      "x-opencode-client": "cli",
    },
    forceStream: true,
    noAuth: true,
    quirks: {
      forceAutoToolChoiceModels: ["muse-spark-1.3-contributor-free"],
    },
  },
  models: [
    // Endpoint formats differ per model, so declare non-chat models explicitly.
    // Updated 2026-10-25: full recheck of every listed model (PONG via router +
    // direct upstream probe). Top 5 = verified working; 3 newly listed upstream
    // free models (beam-free, glm-5.3-flash-free, flint-40b-free) added.
    // flint-40b-free has a slow cold start (30-60s first token).
    // Top 5 = verified working 2026-10-25:
    { id: "mimo-v2.6-flash-free", name: "MiMo V2.6 Flash Free" },
    { id: "deepseek-v4.1-flash-free", name: "DeepSeek V4.1 Flash Free" },
    { id: "big-pickle", name: "Big Pickle Free" },
    { id: "nemotron-3-ultra-free", name: "Nemotron 3 Ultra Free" },
    { id: "nemotron-3.5-lightning-free", name: "Nemotron 3.5 Lightning Free" },
    // Working but slower / behind top 5:
    { id: "nemotron-3.5-super-vl-free", name: "Nemotron 3.5 Super VL Free" },
    { id: "beam-free", name: "Beam Free" },
    { id: "glm-5.3-flash-free", name: "GLM 5.3 Flash Free" },
    { id: "flint-40b-free", name: "Flint 40B Free" },
    // Dead 2026-10-25: 410 deprecated (muse-spark, mimo-v2.5), 400 unavailable
    // upstream (space-bunny, ling), free-pool exhausted (429 / stall: cat-jam,
    // longcat, jev). Keep only if upstream relists them.
    { id: "muse-spark-1.3-contributor-free", name: "Muse Spark 1.3 Contributor Free" },
    { id: "mimo-v2.5-free", name: "MiMo V2.5 Free" },
    { id: "space-bunny-free", name: "Space Bunny Free" },
    { id: "ling-3.0-flash-fin-free", name: "Ling 3.0 Flash Fin Free" },
    { id: "cat-jam-free", name: "Cat Jam Free" },
    { id: "longcat-2.5-preview-free", name: "LongCat 2.5 Preview Free" },
    { id: "jev-1.13-free", name: "Jev 1.13 Free" },
  ],
  serviceKinds: ["llm", "systemone"],
  systemoneConfig: {
    baseUrl: "https://opencode.ai/inference/v1/systemone",
    headers: {
      "x-opencode-client": "cli",
      "User-Agent": "opencode/1.18.31",
    },
  },
  modelsFetcher: { url: "https://opencode.ai/inference/v1/models", type: "opencode-free" },
  passthroughModels: true,
};
