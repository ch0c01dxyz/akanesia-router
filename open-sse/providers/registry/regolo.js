export default {
  id: "regolo",
  priority: 50,
  alias: "regolo",
  display: {
    name: "Regolo",
    icon: "smart_toy",
    color: "#4F46E5",
    textIcon: "RE",
  },
  category: "apikey",
  authType: "apikey",
  transport: {
    // #14996 (upstream): entry sebelumnya menunjuk bare host sehingga
    // request POST ke https://api.regolo.ai (salah); pakai endpoint /v1
    // yang terdokumentasi + discovery via modelsUrl.
    baseUrl: "https://api.regolo.ai/v1/chat/completions",
    modelsUrl: "https://api.regolo.ai/v1/models",
  },
  passthroughModels: true,
  // models dikosongkan: andalkan modelsUrl discovery + passthroughModels
  // (id statis sebelumnya adalah placeholder yang tak ada di katalog).
  models: [],
};

