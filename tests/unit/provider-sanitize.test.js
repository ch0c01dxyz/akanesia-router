import { describe, it, expect } from "vitest";
import { sanitizeConnection, SAFE_FIELDS, SAFE_PSD_FIELDS } from "@/lib/providerSanitize.js";

const kiroConn = {
  id: "conn-1",
  provider: "kiro",
  authType: "oauth",
  name: "Kiro Utama",
  email: "a@b.c",
  priority: 1,
  isActive: true,
  apiKey: "sk-secret-top",
  accessToken: "at-secret",
  refreshToken: "rt-secret",
  idToken: "idt-secret",
  providerSpecificData: {
    profileArn: "arn:aws:iam::123",
    authMethod: "idc",
    clientId: "idc-client",
    clientSecret: "SUPER-RAHASIA",
    region: "us-east-1",
  },
};

const mimoConn = {
  id: "conn-2",
  provider: "openai-compatible-chat-x",
  authType: "apikey",
  name: "mee",
  baseUrl: "https://x.example/v1",
  providerSpecificData: {
    baseUrl: "https://x.example/v1",
    nodeName: "Node X",
    mimoPassToken: "PASS-RAHASIA",
    mimoUserId: "u123",
    uid: "u123",
  },
};

describe("sanitizeConnection", () => {
  it("membuang secret top-level", () => {
    const s = sanitizeConnection(kiroConn, true);
    expect(s.apiKey).toBeUndefined();
    expect(s.accessToken).toBeUndefined();
    expect(s.refreshToken).toBeUndefined();
    expect(s.idToken).toBeUndefined();
    expect(s.name).toBe("Kiro Utama");
    expect(s.id).toBe("conn-1");
  });

  it("membuang clientSecret Kiro IDC dari providerSpecificData", () => {
    const s = sanitizeConnection(kiroConn, true);
    expect(s.providerSpecificData.clientSecret).toBeUndefined();
    expect(s.providerSpecificData.clientId).toBeUndefined();
    // non-secret tetap ada
    expect(s.providerSpecificData.profileArn).toBe("arn:aws:iam::123");
    expect(s.providerSpecificData.region).toBe("us-east-1");
  });

  it("membuang mimoPassToken tapi mempertahankan baseUrl/nodeName", () => {
    const s = sanitizeConnection(mimoConn, true);
    expect(s.providerSpecificData.mimoPassToken).toBeUndefined();
    expect(s.providerSpecificData.baseUrl).toBe("https://x.example/v1");
    expect(s.providerSpecificData.nodeName).toBe("Node X");
    expect(s.providerSpecificData.mimoUserId).toBe("u123");
  });

  it("mode non-admin tidak menyertakan field khusus admin", () => {
    const s = sanitizeConnection(mimoConn, false);
    expect(s.providerSpecificData.baseUrl).toBe("https://x.example/v1");
    expect(s.providerSpecificData.nodeName).toBeUndefined();
    expect(s.providerSpecificData.mimoPassToken).toBeUndefined();
  });

  it("tidak meledak bila providerSpecificData tidak ada", () => {
    const s = sanitizeConnection({ id: "x", name: "y" }, true);
    expect(s.providerSpecificData).toBeUndefined();
    expect(s.id).toBe("x");
  });

  it("allowlist tidak mengandung field secret yang dikenal", () => {
    const all = [...SAFE_FIELDS, ...SAFE_PSD_FIELDS].map((f) => f.toLowerCase());
    for (const bad of ["apikey", "accesstoken", "refreshtoken", "idtoken", "clientsecret", "mimopasstoken", "password"]) {
      expect(all).not.toContain(bad);
    }
  });
});
