import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  json: vi.fn((body, init) => ({
    status: init?.status || 200,
    body,
  })),
  getComboById: vi.fn(),
  getComboByName: vi.fn(),
  updateCombo: vi.fn(),
  resetComboRotation: vi.fn(),
}));

vi.mock("next/server", () => ({
  NextResponse: { json: mocks.json },
}));

vi.mock("@/lib/localDb", () => ({
  getComboById: mocks.getComboById,
  getComboByName: mocks.getComboByName,
  updateCombo: mocks.updateCombo,
}));

vi.mock("open-sse/services/combo.js", () => ({
  resetComboRotation: mocks.resetComboRotation,
}));

const { PATCH } = await import("../../src/app/api/combos/[id]/route.js");

const existing = { id: "c1", name: "lama", kind: "round-robin", models: ["m1"] };
const req = (body) => ({ json: async () => body });

describe("PATCH /api/combos/[id]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getComboById.mockResolvedValue(existing);
    mocks.getComboByName.mockResolvedValue(null);
    // Mirip updateCombo asli: merge parsial, null bila id tidak ada
    mocks.updateCombo.mockImplementation(async (id, data) =>
      id === existing.id ? { ...existing, ...data } : null
    );
  });

  it("mengupdate parsial: field yang dikirim saja yang berubah", async () => {
    const res = await PATCH(req({ kind: "fill-first" }), { params: { id: "c1" } });

    expect(res.status).toBe(200);
    expect(mocks.updateCombo).toHaveBeenCalledWith("c1", { kind: "fill-first" });
    expect(res.body.kind).toBe("fill-first");
    expect(res.body.name).toBe("lama"); // field lain dipertahankan
  });

  it("menolak body kosong dengan 400", async () => {
    for (const body of [{}, null, ""]) {
      const res = await PATCH(req(body), { params: { id: "c1" } });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe("Request body is empty");
    }
    expect(mocks.updateCombo).not.toHaveBeenCalled();
  });

  it("menolak id kosong dengan 400", async () => {
    const res = await PATCH(req({ kind: "fill-first" }), { params: {} });
    expect(res.status).toBe(400);
  });

  it("menolak nama berformat salah dengan 400", async () => {
    const res = await PATCH(req({ name: "nama salah!" }), { params: { id: "c1" } });
    expect(res.status).toBe(400);
    expect(mocks.updateCombo).not.toHaveBeenCalled();
  });

  it("menolak nama duplikat combo lain dengan 400", async () => {
    mocks.getComboByName.mockResolvedValue({ id: "c2", name: "lain" });

    const res = await PATCH(req({ name: "lain" }), { params: { id: "c1" } });

    expect(res.status).toBe(400);
    expect(mocks.updateCombo).not.toHaveBeenCalled();
  });

  it("mengembalikan 404 bila combo tidak ada", async () => {
    const res = await PATCH(req({ kind: "fill-first" }), { params: { id: "hilang" } });
    expect(res.status).toBe(404);
  });

  it("meng-invalidasi rotation state saat rename", async () => {
    const res = await PATCH(req({ name: "baru" }), { params: { id: "c1" } });

    expect(res.status).toBe(200);
    expect(mocks.resetComboRotation).toHaveBeenCalledWith("lama");
    expect(mocks.resetComboRotation).toHaveBeenCalledWith("baru");
  });

  it("mengembalikan 500 saat repo melempar error", async () => {
    mocks.updateCombo.mockRejectedValue(new Error("db down"));

    const res = await PATCH(req({ kind: "fill-first" }), { params: { id: "c1" } });

    expect(res.status).toBe(500);
  });
});
