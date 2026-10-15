export default {
  id: "gitlawb",
  priority: 50,
  alias: "glb",
  display: {
    name: "Gitlawb",
    icon: "smart_toy",
    color: "#16A34A",
    textIcon: "GI",
    website: "https://gitlawb.com",
    notice: {
      apiKeyUrl: "https://gitlawb.com/opengateway/keys",
    },
  },
  category: "apikey",
  authType: "apikey",
  transport: {
    baseUrl: "https://opengateway.gitlawb.com/v1/xiaomi-mimo",
    headers: {
      "User-Agent": "OpenClaude/1.0 (linux; x86_64)",
      "X-Title": "OpenClaude CLI",
      "HTTP-Referer": "https://github.com/Gitlawb/openclaude",
    },
  },
  models: [
    {
      id: "mimo-v2.5-pro",
      name: "MiMo-V2.5-Pro",
      contextLength: 1048576,
      maxOutputTokens: 131072,
    },
    {
      id: "mimo-v2.5",
      name: "MiMo-V2.5",
      contextLength: 1048576,
      maxOutputTokens: 131072,
    },
    {
      id: "mimo-v2-pro",
      name: "MiMo-V2-Pro",
      contextLength: 262144,
      maxOutputTokens: 131072,
    },
    {
      id: "mimo-v2-omni",
      name: "MiMo-V2-Omni",
      contextLength: 262144,
      maxOutputTokens: 131072,
    },
    {
      id: "mimo-v2-flash",
      name: "MiMo-V2-Flash",
      contextLength: 262144,
      maxOutputTokens: 65536,
    },
  ],
};

