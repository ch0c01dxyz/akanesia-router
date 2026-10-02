import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  jsonResponse: vi.fn((body, init) => ({ status: init?.status || 200, body })),
  getSettings: vi.fn(),
  updateSettings: vi.fn(),
}));

vi.mock("next/server", () => ({
  NextResponse: { json: mocks.jsonResponse },
}));

vi.mock("@/lib/localDb", () => ({
  getSettings: mocks.getSettings,
  updateSettings: mocks.updateSettings,
}));

const { GET, PUT } = await import(
  "../../src/app/api/providers/[id]/overrides/route.js"
);

function params(id) {
  return { params: Promise.resolve({ id }) };
}

function putRequest(body) {
  return { json: async () => body };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getSettings.mockResolvedValue({ providerOverrides: {} });
  mocks.updateSettings.mockResolvedValue({});
});

describe("GET /api/providers/[id]/overrides", () => {
  it("tidak 500 — mengembalikan headers + builtinHeaders", async () => {
    const res = await GET({}, params("openai"));
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("headers");
    expect(res.body).toHaveProperty("builtinHeaders");
  });

  it("mengembalikan override tersimpan untuk provider", async () => {
    mocks.getSettings.mockResolvedValue({
      providerOverrides: { openai: { headers: { "X-Custom": "1" } } },
    });
    const res = await GET({}, params("openai"));
    expect(res.status).toBe(200);
    expect(res.body.headers).toEqual({ "X-Custom": "1" });
  });
});

describe("PUT /api/providers/[id]/overrides", () => {
  it("tidak 500 — menyimpan override valid", async () => {
    const res = await PUT(putRequest({ headers: { "X-Custom": "1" } }), params("openai"));
    expect(res.status).toBe(200);
    expect(mocks.updateSettings).toHaveBeenCalledWith({
      providerOverrides: { openai: { headers: { "X-Custom": "1" } } },
    });
  });

  it("menolak header yang diblokir (authorization)", async () => {
    const res = await PUT(
      putRequest({ headers: { authorization: "Bearer x" } }),
      params("openai"),
    );
    expect(res.status).toBe(400);
    expect(mocks.updateSettings).not.toHaveBeenCalled();
  });

  it("payload kosong menghapus override", async () => {
    mocks.getSettings.mockResolvedValue({
      providerOverrides: { openai: { headers: { "X-Custom": "1" } } },
    });
    const res = await PUT(putRequest({ headers: {} }), params("openai"));
    expect(res.status).toBe(200);
    expect(mocks.updateSettings).toHaveBeenCalledWith({ providerOverrides: {} });
  });
});
