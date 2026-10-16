export default {
  id: "chenzk",
  priority: 50,
  alias: "chenzk",
  display: {
    name: "Chenzk",
    icon: "smart_toy",
    color: "#0D9488",
    textIcon: "CH",
  },
  category: "apikey",
  authType: "apikey",
  transport: {
    // 2026-10-16: domain pindah chenzk.top → aotianzz.xyz (info Egar).
    // Catatan jujur: pengumuman resmi tidak terverifikasi independen —
    // hanya berdasarkan info Egar. Jika domain baru tidak merespons,
    // kembalikan atau tandai deprecated.
    baseUrl: "https://aotianzz.xyz/v1/chat/completions",
    validateUrl: "https://aotianzz.xyz/v1/models",
  },
  passthroughModels: true,
  models: [],
};

