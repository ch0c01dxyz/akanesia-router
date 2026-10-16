// Migrate provider id "nous-research" → "nous" (rename registry 2026-10-16).
// Connections yang sudah ada tetap jalan tanpa perlu buat ulang manual.
export default {
  version: 2,
  name: "nous-research-to-nous",
  up(db) {
    try {
      db.run(`UPDATE providerConnections SET provider = 'nous' WHERE provider = 'nous-research'`);
    } catch {}
    try {
      db.run(`UPDATE providerNodes SET provider = 'nous' WHERE provider = 'nous-research'`);
    } catch {}
  },
};
