export default {
  id: "writer",
  priority: 50,
  alias: "writer",
  display: {
    name: "Writer",
    icon: "smart_toy",
    color: "#059669",
    textIcon: "WR",
  },
  category: "apikey",
  authType: "apikey",
  transport: {
    baseUrl: "https://api.writer.com/v1/chat/completions",
    validateUrl: "https://api.writer.com/v1/models",
  },
  models: [
    {
      id: "palmyra-x5",
      name: "Palmyra X5",
      contextLength: 1048576,
    },
    {
      id: "palmyra-x4",
      name: "Palmyra X4",
      contextLength: 131072,
    },
  ],
};

