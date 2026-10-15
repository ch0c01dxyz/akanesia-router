export default {
  id: "xiaomi-mimo-token-plan",
  priority: 50,
  alias: "mimotp",
  display: {
    name: "Xiaomi Mimo Token Plan",
    icon: "smart_toy",
    color: "#16A34A",
    textIcon: "XM",
    website: "https://platform.xiaomimimo.com",
    notice: {
      apiKeyUrl: "https://platform.xiaomimimo.com/console/api-keys",
    },
  },
  category: "apikey",
  authType: "apikey",
  transport: {
    baseUrl: "https://token-plan-sgp.xiaomimimo.com/v1",
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
  ],
};

