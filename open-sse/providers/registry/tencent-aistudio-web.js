// tencent-aistudio-web — Tencent AI Studio web session (OmniRoute: tencent-aistudio-web).
// Chat requests routed through aistudio.tencent.ai via the user's session cookie.
// Model map: hy3-g → HunyuanDefault, hunyuan-default → HunyuanDefault, hunyuan-3d → Hunyuan3D.
export default {
  id: "tencent-aistudio-web",
  alias: "tasw",
  category: "free",
  authType: "cookie",
  authModes: ["cookie"],
  display: {
    name: "Tencent AI Studio Web",
    icon: "savings",
    color: "#0AA6A6",
    textIcon: "TA",
    website: "https://aistudio.tencent.ai",
    notice: {
      text: "Paste your full aistudio.tencent.ai cookie string (the Cookie header) as the credential.",
    },
  },
  transport: {
    baseUrls: ["https://aistudio.tencent.ai/api/chat"],
    format: "openai",
    authHeader: "cookie",
  },
  models: [
    { id: "hy3-g", name: "HY3-G (via Tencent AI Studio)", toolCalling: false },
    { id: "hunyuan-default", name: "Hunyuan Default (via Tencent AI Studio)", toolCalling: false },
    { id: "hunyuan-3d", name: "Hunyuan 3D (via Tencent AI Studio)", toolCalling: false },
  ],
};
