/**
 * Test ide #1 (lazy-load executor): logika murni createAdapterLoader.
 *
 * Tanpa network / tanpa disk: importModule dan toFileUrl di-fake.
 * Kasus yang diuji:
 *   - in-flight dedupe (singleflight): dua pemanggil konkuren berbagi satu import.
 *   - rejection TIDAK di-cache: import gagal → retry berikutnya mencoba lagi.
 *   - adapter gagal terisolasi: satu id rusak tidak mematikan id lain.
 *   - instance yang sukses di-cache (import kedua tidak mengulang).
 *   - getExecutor fail-open: adapter spesialis rusak → DefaultExecutor.
 *   - id tak dikenal → DefaultExecutor via manifest.
 *   - integritas manifest hasil generate: tanpa duplikat, 322 id registry terpetakan.
 */
import { describe, it, expect, vi } from "vitest";
import { createAdapterLoader } from "../../open-sse/executors/index.js";

// ─── Helper: loader dengan importModule fake ─────────────────────────────────

function buatLoader({ manifest = {}, perilaku = {} } = {}) {
  // perilaku: id → "sukses" | "gagal" | { gagalSekali: true }
  const panggil = new Map();
  const fakeImport = vi.fn(async (url) => {
    // url bentuk "file://<id>.js" dari toFileUrl fake di bawah
    const id = url.replace("file://", "").replace(/\.js$/, "");
    panggil.set(id, (panggil.get(id) || 0) + 1);
    const mode = perilaku[id] ?? "sukses";
    // Simulasi latency agar dua pemanggil konkuren benar-benar overlap.
    await new Promise((r) => setTimeout(r, 10));
    if (mode === "gagal") throw new Error(`modul ${id} corrupt`);
    if (mode?.gagalSekali && panggil.get(id) === 1) throw new Error(`modul ${id} gagal sekali`);
    return {
      FakeExecutor: class FakeExecutor {
        constructor(...args) {
          this.args = args;
        }
      },
    };
  });

  const loader = createAdapterLoader({
    manifest,
    toFileUrl: (file) => `file://${file.replace(/^\.\//, "").toLowerCase()}`,
    importModule: fakeImport,
  });
  return { loader, fakeImport, panggil };
}

const MANIFEST = {
  bagus: { file: "./bagus.js", exportName: "FakeExecutor", args: ["bagus"] },
  rusak: { file: "./rusak.js", exportName: "FakeExecutor", args: [] },
  flaky: { file: "./flaky.js", exportName: "FakeExecutor", args: [] },
};

describe("createAdapterLoader — singleflight & cache", () => {
  it("dua pemanggil konkuren berbagi satu import (in-flight dedupe)", async () => {
    const { loader, fakeImport } = buatLoader({ manifest: MANIFEST });
    const [a, b] = await Promise.all([loader.getAdapter("bagus"), loader.getAdapter("bagus")]);
    expect(a).toBe(b); // instance sama
    expect(fakeImport).toHaveBeenCalledTimes(1); // import cuma sekali
    expect(a.args).toEqual(["bagus"]);
  });

  it("instance yang sukses di-cache untuk panggilan berurutan", async () => {
    const { loader, fakeImport } = buatLoader({ manifest: MANIFEST });
    const a = await loader.getAdapter("bagus");
    const b = await loader.getAdapter("bagus");
    expect(a).toBe(b);
    expect(fakeImport).toHaveBeenCalledTimes(1);
  });

  it("rejection TIDAK di-cache: gagal sekali lalu retry berhasil", async () => {
    const { loader, fakeImport, panggil } = buatLoader({
      manifest: MANIFEST,
      perilaku: { flaky: { gagalSekali: true } },
    });
    await expect(loader.getAdapter("flaky")).rejects.toThrow("gagal sekali");
    const inst = await loader.getAdapter("flaky"); // retry → sukses
    expect(inst).toBeTruthy();
    expect(panggil.get("flaky")).toBe(2);
    expect(fakeImport).toHaveBeenCalledTimes(2);
  });

  it("adapter gagal terisolasi: id rusak tidak mematikan id lain", async () => {
    const { loader } = buatLoader({ manifest: MANIFEST, perilaku: { rusak: "gagal" } });
    await expect(loader.getAdapter("rusak")).rejects.toThrow("corrupt");
    // Adapter lain tetap bisa di-load.
    const bagus = await loader.getAdapter("bagus");
    expect(bagus).toBeTruthy();
    // Id rusak tetap bisa di-retry (tidak di-cache sebagai gagal permanen).
    await expect(loader.getAdapter("rusak")).rejects.toThrow("corrupt");
  });

  it("id tak dikenal di manifest → DefaultExecutor", async () => {
    // Untuk id tak dikenal, loader memakai ./default.js dengan args [id].
    const importMasuk = [];
    const hooked = createAdapterLoader({
      manifest: MANIFEST,
      toFileUrl: (file) => `file://${file.replace("./", "").replace(".js", "")}.js`,
      importModule: async (url) => {
        importMasuk.push(url);
        if (url === "file://default.js") {
          return { DefaultExecutor: class { constructor(p) { this.provider = p; } } };
        }
        return { FakeExecutor: class { constructor(...a) { this.args = a; } } };
      },
    });
    const inst = await hooked.getAdapter("provider-asing");
    expect(inst.provider).toBe("provider-asing");
    expect(importMasuk).toContain("file://default.js");
  });
});

describe("getExecutor — fail-open", () => {
  it("adapter spesialis rusak → fallback DefaultExecutor, registry tetap hidup", async () => {
    const fakeImport = vi.fn(async (url) => {
      await new Promise((r) => setTimeout(r, 5));
      if (url === "file://rusak.js") throw new Error("syntax error di adapter");
      if (url === "file://default.js") {
        return { DefaultExecutor: class { constructor(p) { this.provider = p; } } };
      }
      return { FakeExecutor: class {} };
    });
    const loader = createAdapterLoader({
      manifest: MANIFEST,
      toFileUrl: (file) => `file://${file.replace("./", "").replace(".js", "")}.js`,
      importModule: fakeImport,
    });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const ex = await loader.getExecutor("rusak");
      expect(ex.provider).toBe("rusak"); // DefaultExecutor(provider)
      expect(warn).toHaveBeenCalled();
      // Adapter lain tidak terpengaruh.
      const bagus = await loader.getExecutor("bagus");
      expect(bagus).toBeTruthy();
    } finally {
      warn.mockRestore();
    }
  });
});

describe("adapters.manifest.js hasil generate", () => {
  it("tanpa duplikat id dan semua id registry aktif terpetakan", async () => {
    const { ADAPTER_MANIFEST, ADAPTER_IDS } = await import("../../open-sse/executors/adapters.manifest.js");
    const ids = Object.keys(ADAPTER_MANIFEST);
    expect(new Set(ids).size).toBe(ids.length); // tanpa duplikat
    expect(ADAPTER_IDS.length).toBe(ids.length);
    // File registry (index.js hasil generate): hitung entri aktif.
    // Retired providers stay out of the registry; active IDs must all have adapters.
    const registryIndex = (await import("node:fs")).readFileSync(
      new URL("../../open-sse/providers/registry/index.js", import.meta.url),
      "utf8"
    );
    const jumlahEntri = (registryIndex.match(/^import p\d+ from/gm) || []).length;
    const { default: REGISTRY } = await import("../../open-sse/providers/registry/index.js");
    expect(jumlahEntri).toBe(REGISTRY.length);
    for (const entry of REGISTRY) expect(ADAPTER_MANIFEST[entry.id]).toBeDefined();
    for (const id of ADAPTER_IDS) {
      expect(ADAPTER_MANIFEST[id].file).toMatch(/\.js$/); // ekstensi wajib
      expect(typeof ADAPTER_MANIFEST[id].exportName).toBe("string");
    }
    // Provider nonaktif tidak boleh ada di registry maupun manifest.
    for (const nonaktif of ["trae", "windsurf", "devin-cli"]) {
      expect(registryIndex).not.toContain(`"${nonaktif}"`);
      expect(ADAPTER_MANIFEST[nonaktif]).toBeUndefined();
    }
    // Sampel: adapter spesialis + alias + default.
    expect(ADAPTER_MANIFEST["antigravity"].specialized).toBe(true);
    expect(ADAPTER_MANIFEST["agy"].args).toEqual(["agy"]);
    expect(ADAPTER_MANIFEST["anthropic"].specialized).toBe(false);
    expect(ADAPTER_MANIFEST["anthropic"].exportName).toBe("DefaultExecutor");
  });
});
