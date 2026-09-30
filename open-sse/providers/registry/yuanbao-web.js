// yuanbao-web — Tencent Yuanbao consumer web chat via session cookies (OmniRoute: yuanbao-web).
// Two-step flow: POST /api/user/agent/conversation/create, then POST /api/chat/{id};
// Yuanbao SSE events are translated to OpenAI chunks by executors/yuanbao-web.js.
export default {
  id: "yuanbao-web",
  alias: "ybw",
  display: {
    name: "Yuanbao Web",
    icon: "chat",
    color: "#0052D9",
    textIcon: "YB",
    website: "https://yuanbao.tencent.com",
    notice: {
      text: "Paste your full yuanbao.tencent.com cookie string as the credential (it must contain hy_user and hy_token).",
    },
  },
  category: "free",
  authType: "cookie",
  authModes: ["cookie"],
  transport: {
    baseUrl: "https://yuanbao.tencent.com/api/chat",
    format: "openai",
    authHeader: "cookie",
  },
  models: [
    { id: "deepseek-v3", name: "DeepSeek V3 (via Yuanbao)", toolCalling: false },
    { id: "deepseek-r1", name: "DeepSeek R1 (via Yuanbao)", supportsReasoning: true },
    { id: "hunyuan", name: "Hunyuan (via Yuanbao)", toolCalling: false },
    { id: "hunyuan-t1", name: "Hunyuan T1 (via Yuanbao)", supportsReasoning: true },
    { id: "deepseek-v3-search", name: "DeepSeek V3 + Web Search (via Yuanbao)", toolCalling: false },
    {
      id: "deepseek-r1-search",
      name: "DeepSeek R1 + Web Search (via Yuanbao)",
      supportsReasoning: true,
    },
    { id: "hunyuan-search", name: "Hunyuan + Web Search (via Yuanbao)", toolCalling: false },
    {
      id: "hunyuan-t1-search",
      name: "Hunyuan T1 + Web Search (via Yuanbao)",
      supportsReasoning: true,
    },
  ],
};
