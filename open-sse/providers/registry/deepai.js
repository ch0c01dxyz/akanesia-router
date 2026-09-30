// deepai — DeepAI text-to-image (OmniRoute: deepai).
// POST api.deepai.org/api/text2img with `api-key` header; form-encoded text param.
export default {
  id: "deepai",
  priority: 60,
  alias: "deepai",
  uiAlias: "deepai",
  display: {
    name: "DeepAI",
    icon: "image",
    color: "#00A67E",
    textIcon: "DA",
    website: "https://deepai.org",
    notice: {
      apiKeyUrl: "https://deepai.org/apis",
      text: "API key dikirim via header api-key.",
    },
  },
  category: "apikey",
  authType: "apikey",
  transport: {
    baseUrl: "https://api.deepai.org/api/text2img",
    format: "deepai-image",
    authHeader: "api-key",
  },
  models: [
    { id: "text2img", name: "Text to Image", kind: "image" },
  ],
  serviceKinds: ["image"],
};
