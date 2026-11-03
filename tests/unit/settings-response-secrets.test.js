import { describe, it, expect, vi } from "vitest";

// GET/PATCH /api/settings sudah menyaring password + oidcClientSecret, tapi
// mitmSudoEncrypted (sudo password terenkripsi reversibel, kunci machine-bound)
// ikut terkirim ke client padahal tidak ada komponen dashboard yang membacanya.
const stored = {
  comboStrategy: "fallback",
  password: "HASH",
  oidcIssuerUrl: "https://idp.example",
  oidcClientId: "cid",
  oidcClientSecret: "SECRET",
  mitmSudoEncrypted: "iv:tag:ciphertext",
};

let lastUpdate = null;
vi.mock("@/lib/localDb", () => ({
  getSettings: async () => ({ ...stored }),
  updateSettings: async (updates) => {
    lastUpdate = updates;
    return { ...stored, ...updates };
  },
}));
vi.mock("open-sse/services/combo.js", () => ({
  resetComboRotation: () => {},
}));

const { GET, PATCH } = await import("@/app/api/settings/route.js");

function req(body) {
  return new Request("http://localhost/api/settings", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("GET /api/settings tidak membocorkan secret", () => {
  it("tidak mengandung password, oidcClientSecret, maupun mitmSudoEncrypted", async () => {
    const res = await GET();
    const body = await res.json();
    expect(body.password).toBeUndefined();
    expect(body.oidcClientSecret).toBeUndefined();
    expect(body.mitmSudoEncrypted).toBeUndefined();
    expect(body.hasPassword).toBe(true);
    expect(body.oidcConfigured).toBe(true);
  });
});

describe("PATCH /api/settings", () => {
  it("respons tidak mengandung mitmSudoEncrypted dan body terproteksi tidak tersimpan", async () => {
    const res = await PATCH(req({ comboStrategy: "smart", password: "x", mitmSudoEncrypted: "y" }));
    const body = await res.json();
    expect(body.mitmSudoEncrypted).toBeUndefined();
    expect(body.password).toBeUndefined();
    expect(lastUpdate.password).toBeUndefined();
    expect(lastUpdate.mitmSudoEncrypted).toBeUndefined();
    expect(lastUpdate.comboStrategy).toBe("smart");
  });
});
