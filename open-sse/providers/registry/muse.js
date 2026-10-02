// Muse (Meta Model API) — dual auth (pola sama seperti kimi):
//   oauth  = langganan Muse Code (device code akun Meta, mencetak key LLM|…)
//   apikey = key Model API pay-as-you-go dari dev.meta.ai
// Transport dipakai bersama; akun oauth mendapat x-api-version via hook museHeaders.
// Meta tidak menerbitkan refresh token untuk flow langganan → login ulang saat 401.
export default {
  id: "muse",
  priority: 120,
  alias: "muse",
  // CATATAN: "muse-code" SENGAJA tidak dimasukkan — id tersebut sudah dipakai
  // provider lokal muse-code.js (dari merge OmniRoute). Karena
  // ALIAS_TO_PROVIDER_ID dibangun berurutan (id, alias, lalu aliases menimpa),
  // menambahkan "muse-code" di sini akan membajak request muse-code/...
  // ke provider muse secara diam-diam.
  aliases: [
    "muse-ai",
    "meta-model-api",
    "muse-subscription",
  ],
  uiAlias: "muse",
  display: {
    name: "Muse (Meta Model API)",
    icon: "auto_awesome",
    color: "#0866FF",
    textIcon: "MU",
    website: "https://muse.ai",
    notice: {
      text: "Masuk dengan akun Meta Anda (langganan Muse Code) atau tempel Model API key dari dev.meta.ai. Key langganan dicetak per akun; Meta dapat melatih model dari data tier kontributor.",
      apiKeyUrl: "https://dev.meta.ai",
      signupUrl: "https://muse.ai",
    },
  },
  category: "oauth",
  authModes: ["oauth", "apikey"],
  hasOAuth: true,
  transport: {
    baseUrl: "https://api.meta.ai/v1/chat/completions",
    validateUrl: "https://api.meta.ai/v1/models",
    modelsUrl: "https://api.meta.ai/v1/models",
    auth: { combined: true, header: "Authorization", scheme: "bearer", hooks: ["museHeaders"] },
  },
  // Multi-endpoint: Meta menerima format wire Chat Completions dan Responses
  // dengan key yang sama (https://dev.meta.ai/docs/protocols). Reasoning
  // Muse Spark (termasuk replay encrypted_content) hanya round-trip di
  // Responses, jadi model-modelnya di-pin ke targetFormat itu.
  transports: [
    {
      format: "openai",
      baseUrl: "https://api.meta.ai/v1/chat/completions",
      auth: { combined: true, header: "Authorization", scheme: "bearer", hooks: ["museHeaders"] },
    },
    {
      format: "openai-responses",
      baseUrl: "https://api.meta.ai/v1/responses",
      auth: { combined: true, header: "Authorization", scheme: "bearer", hooks: ["museHeaders"] },
    },
  ],
  models: [
    { id: "muse-spark-1.3", name: "Muse Spark 1.3", targetFormat: "openai-responses", supportedFormats: ["openai-responses"] },
    { id: "muse-spark-1.2", name: "Muse Spark 1.2", targetFormat: "openai-responses", supportedFormats: ["openai-responses"] },
    { id: "muse-spark-1.1", name: "Muse Spark 1.1", targetFormat: "openai-responses", supportedFormats: ["openai-responses"] },
    { id: "muse-spark-1.3-contributor", name: "Muse Spark 1.3 Contributor", targetFormat: "openai-responses", supportedFormats: ["openai-responses"] },
    { id: "muse-spark-1.2-contributor", name: "Muse Spark 1.2 Contributor", targetFormat: "openai-responses", supportedFormats: ["openai-responses"] },
  ],
  passthroughModels: true,
  oauth: {
    clientId: "1031625952748946",
    deviceCodeUrl: "https://auth.meta.com/oidc/device/authorization/",
    tokenUrl: "https://auth.meta.com/oidc/device/token/",
  },
};
