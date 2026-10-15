export default {
  id: "naga-ac",
  priority: 50,
  alias: "naga",
  display: {
    name: "Naga Ac",
    icon: "smart_toy",
    color: "#16A34A",
    textIcon: "NA",
    website: "https://naga.ac",
  },
  category: "apikey",
  authType: "optional",
  noAuth: true,
  transport: {
    baseUrl: "https://api.naga.ac/v1/chat/completions",
    validateUrl: "https://api.naga.ac/v1/models",
  },
  passthroughModels: true,
  models: [],
};

