// cursor-api: saudara API-key dari provider `cursor` (sesi IDE).
// Transport, format, dan katalog model sama persis; executor menukar crsr_ key
// menjadi session token 1-jam (di-cache) sebelum dial. Entri registry sendiri
// agar koneksi API-key dan sesi IDE tidak berbagi semantik renewal/dashboard.
import cursorEntry from "./cursor.js";

export default {
  id: "cursor-api",
  priority: 50,
  alias: "cua",
  uiAlias: "cua",
  display: {
    name: "Cursor API",
    icon: "edit_note",
    color: "#00D4AA",
    website: "https://cursor.com",
    notice: {
      apiKeyUrl: "https://cursor.com/dashboard/api",
    },
  },
  category: "apikey",
  authType: "apikey",
  transport: cursorEntry.transport,
  models: cursorEntry.models,
};
