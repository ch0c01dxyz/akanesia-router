// veoaifree-web — Veo AI Free multi-tool provider (OmniRoute: veoaifree-web).
// Routes through veoaifree.com's WordPress AJAX API. Supports text-to-video,
// image-to-video, image generation, TTS, and prompt enhancement. No auth
// required; rate limited to 6 requests/hour per IP.
export default {
  id: "veoaifree-web",
  alias: "veo-free",
  uiAlias: "veo-free",
  display: {
    name: "Veo AI Free",
    icon: "movie",
    color: "#7C3AED",
    textIcon: "VF",
    website: "https://veoaifree.com",
    notice: {
      text: "Free anonymous access — no account or API key needed. Rate limited to 6 requests/hour per IP.",
      signupUrl: "https://veoaifree.com",
    },
  },
  category: "free",
  authType: "none",
  authModes: [],
  noAuth: true,
  transport: {
    baseUrl: "https://veoaifree.com/wp-admin/admin-ajax.php",
    format: "openai",
    authHeader: "none",
  },
  models: [
    { id: "veo", name: "VEO 3.1", toolCalling: false },
    { id: "seedance", name: "Seedance", toolCalling: false },
  ],
};
