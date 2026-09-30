import { describe, it, expect, vi, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const mocks = vi.hoisted(() => ({
  execFile: vi.fn(),
  execFileSync: vi.fn(() => { throw new Error("not found"); }),
}));

vi.mock("child_process", () => ({
  execFile: mocks.execFile,
  execFileSync: mocks.execFileSync,
}));

// Route (file, args) -> stdout string, atau throw agar mensimulasikan kegagalan proses.
// Callback di-emit sebagai objek { stdout, stderr } agar cocok dengan kontrak
// util.promisify(execFile) asli (execFile asli mendefinisikan promisify.custom
// yang resolve ke objek tersebut; vi.fn tidak memilikinya).
function mockExecFile(handler) {
  mocks.execFile.mockImplementation((file, args, opts, cb) => {
    const callback = typeof opts === "function" ? opts : cb;
    try {
      const out = handler(file, args || []);
      callback(null, { stdout: out, stderr: "" });
    } catch (e) {
      callback(e);
    }
  });
}

const PIP_LIST_JSON = JSON.stringify([
  { name: "headroom-ai", version: "0.26.0" },
  { name: "tree-sitter", version: "0.25.0" },
]);

// Buat direktori bin palsu berisi executable headroom + python3 agar
// pengecekan isExecutablePath memakai fs asli (tanpa mock fs).
function makeFakeBin({ withHeadroomExtras = true } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hr-detect-"));
  const headroomBin = path.join(dir, "headroom");
  const binPython = path.join(dir, "python3");
  for (const p of [headroomBin, binPython]) {
    fs.writeFileSync(p, "#!/bin/sh\nexit 0\n", { mode: 0o755 });
  }
  return { dir, headroomBin, binPython, withHeadroomExtras };
}

import {
  findPython310,
  getHeadroomStatus,
  getInstalledHeadroomExtras,
  isLoopbackHeadroomUrl,
  invalidateHeadroomStatusCache,
} from "../../src/lib/headroom/detect.js";

afterEach(() => {
  vi.clearAllMocks();
  invalidateHeadroomStatusCache();
});

describe("headroom detect (async)", () => {
  it("detects installed headroom version and extras from pip list", async () => {
    mockExecFile((file, args) => {
      if (file === "python3" && args.join(" ") === "-m pip list --format=json --disable-pip-version-check") {
        return PIP_LIST_JSON;
      }
      throw new Error(`unexpected: ${file} ${args.join(" ")}`);
    });

    const result = await getInstalledHeadroomExtras("python3");

    expect(mocks.execFile).toHaveBeenCalledWith(
      "python3",
      ["-m", "pip", "list", "--format=json", "--disable-pip-version-check"],
      expect.objectContaining({ windowsHide: true, timeout: 8000 }),
      expect.any(Function),
    );
    expect(result).toEqual({
      installed: true,
      version: "0.26.0",
      extras: { code: true, ml: false },
      via: "pip",
    });
  });

  it("prefers the interpreter that actually has headroom-ai installed", async () => {
    const { headroomBin, binPython } = makeFakeBin();
    mockExecFile((file, args) => {
      const a = args.join(" ");
      if (file === "which" && args[0] === "headroom") return `${headroomBin}\n`;
      if (file === headroomBin && a === "--version") return "headroom 0.26.0\n";
      if (file === binPython && a === "--version") return "Python 3.13.0\n";
      if (file === binPython && a === "-m pip show headroom-ai") {
        return "Name: headroom-ai\nVersion: 0.26.0\n";
      }
      if (a === "-m pip show headroom-ai") throw new Error("not installed");
      if (a === "--version") return "Python 3.12.0\n";
      throw new Error(`unexpected: ${file} ${a}`);
    });

    expect(await findPython310()).toBe(binPython);
  });

  it("keeps top-level installed flag true when extras are readable", async () => {
    const { headroomBin, binPython } = makeFakeBin();
    global.fetch = vi.fn(async () => new Response("ok", { status: 200 }));
    mockExecFile((file, args) => {
      const a = args.join(" ");
      if (file === "which" && args[0] === "headroom") return `${headroomBin}\n`;
      if (file === headroomBin && a === "--version") return "headroom 0.26.0\n";
      if (file === binPython && a === "--version") return "Python 3.13.0\n";
      if (file === binPython && a === "-m pip show headroom-ai") {
        return "Name: headroom-ai\nVersion: 0.26.0\n";
      }
      if (a === "-m pip show headroom-ai") throw new Error("not installed");
      if (a === "-m pip list --format=json --disable-pip-version-check") {
        if (file === binPython) return PIP_LIST_JSON;
        throw new Error("no headroom here");
      }
      if (a === "--version") return "Python 3.12.0\n";
      throw new Error(`unexpected: ${file} ${a}`);
    });

    const status = await getHeadroomStatus("http://localhost:8787");

    expect(status.installed).toBe(true);
    expect(status.version).toBe("0.26.0");
    expect(status.extras).toEqual({ code: true, ml: false });
    expect(status.running).toBe(true);
  });

  it("treats a reachable external proxy as running without local CLI", async () => {
    global.fetch = vi.fn(async () => new Response("ok", { status: 200 }));
    mockExecFile(() => { throw new Error("not found"); });

    const status = await getHeadroomStatus("http://headroom:8787");

    expect(status.installed).toBe(false);
    expect(status.running).toBe(true);
    expect(status.localUrl).toBe(false);
    expect(status.canStart).toBe(false);
    expect(global.fetch).toHaveBeenCalledWith("http://headroom:8787/health", expect.any(Object));
  });

  it("recognizes loopback URLs for managed local mode", () => {
    expect(isLoopbackHeadroomUrl("http://localhost:8787")).toBe(true);
    expect(isLoopbackHeadroomUrl("http://127.0.0.1:8787")).toBe(true);
    expect(isLoopbackHeadroomUrl("http://headroom:8787")).toBe(false);
    expect(isLoopbackHeadroomUrl("not-a-url")).toBe(false);
  });
});
