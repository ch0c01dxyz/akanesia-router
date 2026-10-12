import { describe, it, expect, vi, beforeEach } from "vitest";

const incidents = [
  {
    connectionId: "conn-1",
    model: "m1",
    provider: "openai-compatible-chat-3d6fbd5c-0cd7-4d0d-98a8-d2f0ae6a6e5d",
    errorClass: "rate_limited",
    lastError: "429",
    lastStatus: 429,
    failureCount: 3,
  },
  {
    connectionId: "conn-2",
    model: "m2",
    provider: "openai",
    errorClass: "auth",
    lastError: "401",
    lastStatus: 401,
    failureCount: 1,
  },
  {
    connectionId: "conn-hilang",
    model: "m3",
    provider: "provider-tak-dikenal",
    errorClass: "server",
    lastError: "500",
    lastStatus: 500,
    failureCount: 2,
  },
];

const connections = [
  { id: "conn-1", provider: "openai-compatible-chat-3d6fbd5c-0cd7-4d0d-98a8-d2f0ae6a6e5d", name: "LLM Kantorku" },
  { id: "conn-2", provider: "openai", name: "" },
];

vi.mock("@/models", () => ({
  listIncidents: async () => incidents,
  getProviderConnections: async () => connections,
}));

const { GET } = await import("@/app/api/quota-incidents/route.js");

describe("GET /api/quota-incidents", () => {
  it("providerName = nama koneksi untuk provider kompatibel dinamis", async () => {
    const res = await GET();
    const data = await res.json();
    const inc = data.incidents.find((i) => i.connectionId === "conn-1");
    expect(inc.providerName).toBe("LLM Kantorku");
    // id mentah tetap ada untuk kompatibilitas
    expect(inc.provider).toBe("openai-compatible-chat-3d6fbd5c-0cd7-4d0d-98a8-d2f0ae6a6e5d");
  });

  it("providerName = nama AI_PROVIDERS bila koneksi tak bernama", async () => {
    const res = await GET();
    const data = await res.json();
    const inc = data.incidents.find((i) => i.connectionId === "conn-2");
    // openai ada di AI_PROVIDERS → nama tampilannya, bukan id mentah
    expect(inc.providerName).not.toBe("openai");
    expect(typeof inc.providerName).toBe("string");
  });

  it("providerName fallback ke id mentah bila tak dikenal", async () => {
    const res = await GET();
    const data = await res.json();
    const inc = data.incidents.find((i) => i.connectionId === "conn-hilang");
    expect(inc.providerName).toBe("provider-tak-dikenal");
  });
});
