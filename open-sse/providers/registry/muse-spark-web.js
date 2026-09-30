// muse-spark-web — Meta AI web chat via GraphQL + protobuf WebSocket (OmniRoute: muse-spark-web).
// Custom executor: open-sse/executors/muse-spark-web.js — warmup/mode-switch GraphQL calls,
// then streams over wss://gateway.meta.ai/ws/clippy (protobuf templates), translating
// frames into OpenAI SSE chunks. Paste your full meta.ai cookie string as the credential.
export default {
  id: "muse-spark-web",
  alias: "ms-web",
  uiAlias: "ms-web",
  display: {
    name: "Muse Spark Web",
    icon: "auto_awesome",
    color: "#0081FB",
    textIcon: "MS",
    website: "https://www.meta.ai",
    notice: {
      signupUrl: "https://www.meta.ai",
      text: "Paste your full meta.ai cookie string as the API key. The WebSocket chat also needs the ecto1:... auth token — paste it alongside the cookie (or set provider-specific authorization).",
    },
  },
  category: "free",
  authType: "cookie",
  authModes: ["cookie"],
  transport: {
    baseUrl: "https://www.meta.ai/api/graphql",
    format: "openai",
    authHeader: "cookie",
  },
  models: [
    { id: "muse-spark", name: "Muse Spark", toolCalling: false },
    { id: "muse-spark-thinking", name: "Muse Spark Thinking", supportsReasoning: true },
    { id: "muse-spark-contemplating", name: "Muse Spark Contemplating", supportsReasoning: true },
  ],
};
