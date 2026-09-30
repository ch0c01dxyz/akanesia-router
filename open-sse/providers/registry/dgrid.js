export default {
  id: "dgrid",
  priority: 50,
  alias: "dgrid",
  display: {
    name: "Dgrid",
    icon: "smart_toy",
    color: "#4F46E5",
    textIcon: "DG",
  },
  category: "apikey",
  authType: "apikey",
  transport: {
    baseUrl: "https://api.dgrid.ai/v1/chat/completions",
    validateUrl: "https://api.dgrid.ai/v1/models",
  },
  passthroughModels: true,
  models: [
    { id: "dgridai/free", name: "DGrid Free Models Router" },
  ],
};

