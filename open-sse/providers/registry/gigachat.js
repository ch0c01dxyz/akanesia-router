export default {
  id: "gigachat",
  priority: 50,
  alias: "gigachat",
  display: {
    name: "Gigachat",
    icon: "smart_toy",
    color: "#D97706",
    textIcon: "GI",
    website: "https://developers.sber.ru",
    notice: {
      apiKeyUrl: "https://developers.sber.ru/studio",
    },
  },
  category: "apikey",
  authType: "apikey",
  transport: {
    baseUrl: "https://gigachat.devices.sberbank.ru/api/v1",
  },
  models: [
    { id: "GigaChat-2-Max", name: "GigaChat-2-Max" },
    { id: "GigaChat-2-Pro", name: "GigaChat-2-Pro" },
    { id: "GigaChat-2-Lite", name: "GigaChat-2-Lite" },
  ],
};

