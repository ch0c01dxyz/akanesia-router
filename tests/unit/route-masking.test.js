import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  validateRouteMaskInput,
  normalizeMaskKey,
  koneksiPunyaKredensial,
  cariKoneksiBerkredensial,
  ROUTE_MASKING_OWNED_BY,
} from "@/lib/routeMasking.js";

describe("validateRouteMaskInput", () => {
  it("contoh 1 Egar: prefix beda & virtual -> diizinkan", () => {
    const r = validateRouteMaskInput("routerlokal/glm-5.3-flash", "dahono/glm-5.3-flash");
    expect(r.ok).toBe(true);
    expect(r.alias).toBe("routerlokal/glm-5.3-flash");
    expect(r.providerPart).toBe("dahono");
    expect(r.modelPart).toBe("glm-5.3-flash");
  });

  it("contoh 3 Egar: satu provider tapi beda nama model -> diizinkan", () => {
    const r = validateRouteMaskInput("dahono/glm-5.3-flashx", "dahono/glm-5.3-flash");
    expect(r.ok).toBe(true);
  });

  it("contoh 2 Egar: sama persis -> DITOLAK dengan pesan persis", () => {
    const r = validateRouteMaskInput("dahono/glm-5.3-flash", "dahono/glm-5.3-flash");
    expect(r.ok).toBe(false);
    expect(r.error).toBe("Masking model should be different than model real name");
  });

  it("duplikat case-insensitive juga ditolak", () => {
    expect(
      validateRouteMaskInput("Dahono/GLM-5.3-Flash", "dahono/glm-5.3-flash").error
    ).toBe("Masking model should be different than model real name");
  });

  it("menolak nama samaran tanpa format prefix/model", () => {
    const r = validateRouteMaskInput("harness-qwen-1", "openai/gpt-5");
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/prefix\/model/);
  });

  it("menolak nama samaran kosong", () => {
    expect(validateRouteMaskInput("", "openai/gpt-5").ok).toBe(false);
    expect(validateRouteMaskInput("   ", "openai/gpt-5").ok).toBe(false);
  });

  it("menolak spasi di dalam nama samaran", () => {
    expect(validateRouteMaskInput("router lokal/x", "openai/gpt-5").ok).toBe(false);
    expect(validateRouteMaskInput("routerlokal/nama model", "openai/gpt-5").ok).toBe(false);
  });

  it("menolak target tanpa format provider/model", () => {
    expect(validateRouteMaskInput("routerlokal/x", "gpt-5").ok).toBe(false);
    expect(validateRouteMaskInput("routerlokal/x", "/gpt-5").ok).toBe(false);
    expect(validateRouteMaskInput("routerlokal/x", "openai/").ok).toBe(false);
    expect(validateRouteMaskInput("routerlokal/x", "").ok).toBe(false);
  });

  it("trim spasi di sekitar input", () => {
    const r = validateRouteMaskInput("  routerlokal/x  ", "  openai/gpt-5  ");
    expect(r.ok).toBe(true);
    expect(r.alias).toBe("routerlokal/x");
    expect(r.target).toBe("openai/gpt-5");
  });
});

describe("koneksiPunyaKredensial", () => {
  it("true bila ada apiKey / accessToken / refreshToken", () => {
    expect(koneksiPunyaKredensial({ apiKey: "sk-x" })).toBe(true);
    expect(koneksiPunyaKredensial({ accessToken: "tok" })).toBe(true);
    expect(koneksiPunyaKredensial({ refreshToken: "ref" })).toBe(true);
  });

  it("false bila tidak ada kredensial", () => {
    expect(koneksiPunyaKredensial({ apiKey: "" })).toBe(false);
    expect(koneksiPunyaKredensial({ apiKey: "   " })).toBe(false);
    expect(koneksiPunyaKredensial({})).toBe(false);
    expect(koneksiPunyaKredensial(null)).toBe(false);
  });

  it("true untuk authType none/free/optional dan ollama-local", () => {
    expect(koneksiPunyaKredensial({ authType: "none" })).toBe(true);
    expect(koneksiPunyaKredensial({ authType: "free" })).toBe(true);
    expect(koneksiPunyaKredensial({ authType: "optional" })).toBe(true);
    expect(koneksiPunyaKredensial({ provider: "ollama-local" })).toBe(true);
  });
});

describe("cariKoneksiBerkredensial", () => {
  const connections = [
    { id: "c1", provider: "openai", isActive: true, apiKey: "sk-1" },
    { id: "c2", provider: "anthropic", isActive: true, apiKey: "" },
    { id: "c3", provider: "xai", isActive: false, apiKey: "sk-3" },
    {
      id: "c4",
      provider: "openai-compatible-chat-abc",
      isActive: true,
      apiKey: "sk-4",
      providerSpecificData: { prefix: "mynode" },
    },
  ];

  it("menemukan koneksi aktif berkredensial via id provider", () => {
    expect(cariKoneksiBerkredensial("openai", connections)?.id).toBe("c1");
  });

  it("menemukan koneksi via prefix node kustom", () => {
    expect(cariKoneksiBerkredensial("mynode", connections)?.id).toBe("c4");
  });

  it("melewatkan koneksi tanpa kredensial dan yang nonaktif", () => {
    expect(cariKoneksiBerkredensial("anthropic", connections)).toBeNull();
    expect(cariKoneksiBerkredensial("xai", connections)).toBeNull();
  });

  it("null bila provider tidak dikenal / input kosong", () => {
    expect(cariKoneksiBerkredensial("tidak-ada", connections)).toBeNull();
    expect(cariKoneksiBerkredensial("", connections)).toBeNull();
  });
});

describe("normalizeMaskKey", () => {
  it("lowercase + trim agar lookup konsisten case-insensitive", () => {
    expect(normalizeMaskKey("  RouterLokal/GLM-5.3-Flash  ")).toBe("routerlokal/glm-5.3-flash");
    expect(normalizeMaskKey("dahono/x")).toBe("dahono/x");
    expect(normalizeMaskKey(null)).toBe("");
  });
});

describe("renameModelAlias (atomik)", () => {
  const originalDataDir = process.env.DATA_DIR;
  let cleanup = () => {};

  beforeEach(async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "akanesia-rename-mask-"));
    process.env.DATA_DIR = tempDir;
    // Adapter DB di-cache di global (anti-HMR) — reset agar tiap test
    // benar-benar memakai DB temp dir-nya sendiri.
    delete global._dbAdapter;
    vi.resetModules();
    cleanup = () => fs.rmSync(tempDir, { recursive: true, force: true });
  });

  afterEach(() => {
    process.env.DATA_DIR = originalDataDir;
    global._dbAdapter?.instance?.close();
    delete global._dbAdapter;
    cleanup();
    vi.resetModules();
  });

  it("rename: tulis baru + hapus lama, tidak ada data loss", async () => {
    const { setModelAlias, renameModelAlias, getModelAliases } = await import("@/models/index.js");
    await setModelAlias("routerlokal/lama", "openai/gpt-5");
    await renameModelAlias("routerlokal/lama", "routerlokal/baru", "openai/gpt-5");
    const aliases = await getModelAliases();
    expect(aliases["routerlokal/baru"]).toBe("openai/gpt-5");
    expect(aliases["routerlokal/lama"]).toBeUndefined();
  });

  it("rename me-retarget sekaligus bila target berubah", async () => {
    const { setModelAlias, renameModelAlias, getModelAliases } = await import("@/models/index.js");
    await setModelAlias("routerlokal/lama", "openai/gpt-5");
    await renameModelAlias("routerlokal/lama", "routerlokal/baru", "anthropic/claude-x");
    const aliases = await getModelAliases();
    expect(aliases["routerlokal/baru"]).toBe("anthropic/claude-x");
    expect(aliases["routerlokal/lama"]).toBeUndefined();
  });
});

describe("getModelInfo: mask -> target prefix node kustom", () => {
  const originalDataDir = process.env.DATA_DIR;
  let cleanup = () => {};

  beforeEach(async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "akanesia-mask-node-"));
    process.env.DATA_DIR = tempDir;
    // Adapter DB di-cache di global (anti-HMR) — reset agar tiap test
    // benar-benar memakai DB temp dir-nya sendiri.
    delete global._dbAdapter;
    vi.resetModules();
    cleanup = () => fs.rmSync(tempDir, { recursive: true, force: true });
  });

  afterEach(() => {
    process.env.DATA_DIR = originalDataDir;
    global._dbAdapter?.instance?.close();
    delete global._dbAdapter;
    cleanup();
    vi.resetModules();
  });

  it("mask ke target node kustom me-resolve ke node id (bukan prefix mentah)", async () => {
    const { createProviderNode } = await import("@/models/index.js");
    const { setModelAlias } = await import("@/models/index.js");
    const { getModelInfo } = await import("@/sse/services/model.js");
    const node = await createProviderNode({
      type: "openai-compatible",
      name: "Dahono Node",
      prefix: "dahono",
      apiType: "openai",
      baseUrl: "https://example.invalid/v1",
    });
    await setModelAlias("routerlokal/glm-5.3-flash", "dahono/glm-5.3-flash");
    const info = await getModelInfo("routerlokal/glm-5.3-flash");
    // Kritis: harus node id agar pencarian kredensial menemukan koneksi node.
    expect(info.provider).toBe(node.id);
    expect(info.model).toBe("glm-5.3-flash");
  });

  it("mask ke target alias provider lokal (xmtp) ikut ter-resolve", async () => {
    const { setModelAlias } = await import("@/models/index.js");
    const { getModelInfo } = await import("@/sse/services/model.js");
    await setModelAlias("routerlokal/qwen", "xmtp/qwen-flash");
    const info = await getModelInfo("routerlokal/qwen");
    expect(info.provider).toBe("xiaomi-tokenplan");
    expect(info.model).toBe("qwen-flash");
  });

  it("mask ke target provider reserved tidak salah dianggap node", async () => {
    const { setModelAlias } = await import("@/models/index.js");
    const { getModelInfo } = await import("@/sse/services/model.js");
    await setModelAlias("routerlokal/gpt", "openai/gpt-5");
    const info = await getModelInfo("routerlokal/gpt");
    expect(info.provider).toBe("openai");
    expect(info.model).toBe("gpt-5");
  });
});

describe("modelsCache (modul non-route)", () => {
  it("set/get/invalidate bekerja dengan TTL", async () => {
    vi.resetModules();
    const { getModelsCache, setModelsCache, invalidateModelsCache } = await import("@/lib/modelsCache.js");
    expect(getModelsCache(["llm"], false)).toBeNull();
    const data = [{ id: "openai/gpt-5" }];
    setModelsCache(["llm"], false, data);
    expect(getModelsCache(["llm"], false)).toBe(data);
    invalidateModelsCache();
    expect(getModelsCache(["llm"], false)).toBeNull();
    vi.resetModules();
  });
});

describe("invalidateMaskAliasCache", () => {
  it("diekspos dari sse/services/model.js", async () => {
    const mod = await import("@/sse/services/model.js");
    expect(typeof mod.invalidateMaskAliasCache).toBe("function");
  });
});
describe("resolusi nama samaran di jalur chat", () => {
  it("resolveModelAliasFromMap me-resolve key berformat prefix/model", async () => {
    // Lapisan integrasi (getModelInfo di src) mencocokkan full-string dulu;
    // di sini diverifikasi resolver map-nya menangani key "prefix/model".
    const { resolveModelAliasFromMap } = await import("open-sse/services/model.js");
    const aliases = { "routerlokal/glm-5.3-flash": "dahono/glm-5.3-flash" };
    const info = resolveModelAliasFromMap("routerlokal/glm-5.3-flash", aliases);
    expect(info.provider).toBe("dahono");
    expect(info.model).toBe("glm-5.3-flash");
  });

  it("owned_by untuk entri /v1/models konsisten", () => {
    expect(ROUTE_MASKING_OWNED_BY).toBe("route-masking");
  });
});

describe("getModelInfo: full-string mask dicek dulu sebelum parse provider/model", () => {
  const originalDataDir = process.env.DATA_DIR;
  let cleanup = () => {};

  beforeEach(async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "akanesia-route-masking-"));
    process.env.DATA_DIR = tempDir;
    // Adapter DB di-cache di global (anti-HMR) — reset agar tiap test
    // benar-benar memakai DB temp dir-nya sendiri.
    delete global._dbAdapter;
    vi.resetModules();
    cleanup = () => fs.rmSync(tempDir, { recursive: true, force: true });
  });

  afterEach(() => {
    process.env.DATA_DIR = originalDataDir;
    global._dbAdapter?.instance?.close();
    delete global._dbAdapter;
    cleanup();
    vi.resetModules();
  });

  it("mask 'routerlokal/glm-5.3-flash' me-resolve ke target asli", async () => {
    const { setModelAlias } = await import("@/models/index.js");
    const { getModelInfo } = await import("@/sse/services/model.js");
    await setModelAlias("routerlokal/glm-5.3-flash", "dahono/glm-5.3-flash");
    const info = await getModelInfo("routerlokal/glm-5.3-flash");
    expect(info.provider).toBe("dahono");
    expect(info.model).toBe("glm-5.3-flash");
  });

  it("mask berprefix provider asli menang atas parsing provider/model biasa", async () => {
    const { setModelAlias } = await import("@/models/index.js");
    const { getModelInfo } = await import("@/sse/services/model.js");
    await setModelAlias("dahono/glm-5.3-flashx", "openai/gpt-5");
    const info = await getModelInfo("dahono/glm-5.3-flashx");
    expect(info.provider).toBe("openai");
    expect(info.model).toBe("gpt-5");
  });

  it("model provider/model biasa tanpa mask tetap parsing normal", async () => {
    const { getModelInfo } = await import("@/sse/services/model.js");
    const info = await getModelInfo("openai/gpt-5");
    expect(info.provider).toBe("openai");
    expect(info.model).toBe("gpt-5");
  });
});
