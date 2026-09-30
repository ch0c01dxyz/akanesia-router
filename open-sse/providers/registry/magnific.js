// magnific — Magnific Mystic image provider (OmniRoute: magnific).
// Async submit task_id, then poll GET /v1/ai/mystic/{task_id}.
export default {
  id: "magnific",
  priority: 60,
  alias: "magnific",
  aliases: ["freepik"],
  uiAlias: "magnific",
  display: {
    name: "Magnific",
    icon: "image",
    color: "#6366F1",
    textIcon: "MG",
    website: "https://magnific.com",
    notice: {
      apiKeyUrl: "https://magnific.com → Settings → Organization → API Keys",
      text: "API key dikirim via header x-magnific-api-key.",
    },
  },
  category: "apikey",
  authType: "apikey",
  transport: {
    baseUrl: "https://api.magnific.com/v1/ai/mystic",
    format: "magnific-image",
    authHeader: "x-magnific-api-key",
  },
  models: [
    { id: "realism", name: "Mystic Realism", kind: "image" },
    { id: "fluid", name: "Mystic Fluid (Imagen 3)", kind: "image" },
    { id: "zen", name: "Mystic Zen", kind: "image" },
    { id: "flexible", name: "Mystic Flexible", kind: "image" },
    { id: "super_real", name: "Mystic Super Real", kind: "image" },
    { id: "editorial_portraits", name: "Mystic Editorial Portraits", kind: "image" },
  ],
  serviceKinds: ["image"],
};
