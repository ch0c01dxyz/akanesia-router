export default {
  id: "charm-hyper",
  priority: 50,
  alias: "charm-hyper",
  display: {
    name: "Charm Hyper",
    icon: "smart_toy",
    color: "#4F46E5",
    textIcon: "CH",
    website: "https://hyper.charm.land",
    notice: { apiKeyUrl: "https://hyper.charm.land" },
  },
  category: "apikey",
  authType: "apikey",
  transport: {
    baseUrl: "https://hyper.charm.land/v1/chat/completions",
    validateUrl: "https://hyper.charm.land/v1/models",
  },
  passthroughModels: true,
  models: [
    { id: "hyper/auto", name: "Charm Hyper Auto" },
  ],
};

