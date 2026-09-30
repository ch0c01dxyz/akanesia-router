/**
 * Unit test: deteksi platform & validasi executable (src/lib/platform.js).
 *
 * Latar: halaman Token Saver memicu dialog "Open with" di Windows 11 karena
 * kandidat binary di-probe lewat shell (cmd.exe → asosiasi ekstensi).
 * Modul platform.js memastikan:
 *  - environment terdeteksi eksplisit: windows / macos / linux,
 *  - file yang bukan executable di platform aktif ditolak SEBELUM dieksekusi,
 *  - probing tidak pernah lewat shell (kecuali .bat/.cmd di Windows).
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  getOsKind,
  IS_WINDOWS,
  IS_MACOS,
  IS_LINUX,
  windowsExecutableExtensions,
  isExecutablePath,
  probeRun,
  findOnPath,
} from "@/lib/platform.js";

let tmpDir;

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "platform-test-"));
});

afterAll(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("getOsKind", () => {
  it("mengembalikan salah satu dari windows/macos/linux", () => {
    expect(["windows", "macos", "linux"]).toContain(getOsKind());
  });

  it("konsisten dengan process.platform", () => {
    const p = process.platform;
    if (p === "win32") expect(getOsKind()).toBe("windows");
    else if (p === "darwin") expect(getOsKind()).toBe("macos");
    else expect(getOsKind()).toBe("linux");
  });

  it("flag IS_WINDOWS/IS_MACOS/IS_LINUX konsisten", () => {
    expect(IS_WINDOWS).toBe(getOsKind() === "windows");
    expect(IS_MACOS).toBe(getOsKind() === "macos");
    expect(IS_LINUX).toBe(getOsKind() === "linux");
  });
});

describe("windowsExecutableExtensions", () => {
  it("memuat .exe dari PATHEXT", () => {
    expect(windowsExecutableExtensions()).toContain(".exe");
  });
});

describe("isExecutablePath", () => {
  it("menolak null/undefined/string kosong", () => {
    expect(isExecutablePath(null)).toBe(false);
    expect(isExecutablePath(undefined)).toBe(false);
    expect(isExecutablePath("")).toBe(false);
  });

  it("menolak path yang tidak ada & direktori", () => {
    expect(isExecutablePath(path.join(tmpDir, "tidak-ada"))).toBe(false);
    expect(isExecutablePath(tmpDir)).toBe(false);
  });

  it("unix: file tanpa execute bit ditolak, dengan +x diterima", () => {
    if (IS_WINDOWS) return; // cabang unix saja
    const f = path.join(tmpDir, "skrip-tanpa-x");
    fs.writeFileSync(f, "#!/bin/sh\necho hi\n");
    fs.chmodSync(f, 0o644);
    expect(isExecutablePath(f)).toBe(false);
    fs.chmodSync(f, 0o755);
    expect(isExecutablePath(f)).toBe(true);
  });
});

describe("probeRun (tanpa shell)", () => {
  it("true untuk binary asli yang jalan (node --version)", () => {
    expect(probeRun(process.execPath, ["--version"])).toBe(true);
  });

  it("false untuk path yang tidak ada — tanpa throw", () => {
    expect(probeRun(path.join(tmpDir, "tidak-ada"))).toBe(false);
  });

  it("false untuk file non-executable — tanpa throw", () => {
    const f = path.join(tmpDir, "data.txt");
    fs.writeFileSync(f, "bukan executable");
    expect(probeRun(f, ["--version"])).toBe(false);
  });

  it("menolak pyenv shim: probe --version gagal → false", () => {
    // Shim generik pyenv — persis konten yang memicu dialog "Open with":
    //   #!/bin/sh
    //   pyenv exec $(basename "$0") "$@"
    // Di mesin tanpa pyenv, `--version` gagal → shim tidak dianggap binary valid.
    if (IS_WINDOWS) return; // butuh chmod +x; di Windows ditolak via PATHEXT
    const shim = path.join(tmpDir, "headroom");
    fs.writeFileSync(shim, '#!/bin/sh\npyenv exec $(basename "$0") "$@"\n');
    fs.chmodSync(shim, 0o755);
    expect(isExecutablePath(shim)).toBe(true); // lolos cek executable unix…
    expect(probeRun(shim, ["--version"])).toBe(false); // …tapi gagal probe
  });
});

describe("findOnPath", () => {
  it("menemukan node di PATH", () => {
    const found = findOnPath("node");
    expect(found).toBeTruthy();
    expect(isExecutablePath(found)).toBe(true);
  });

  it("null untuk nama yang tidak ada", () => {
    expect(findOnPath("binary-yang-pasti-tidak-ada-xyz")).toBeNull();
  });

  it("null untuk input kosong", () => {
    expect(findOnPath("")).toBeNull();
    expect(findOnPath(null)).toBeNull();
  });

  it("memakai extraPath yang diberikan", () => {
    if (IS_WINDOWS) return;
    const dir = fs.mkdtempSync(path.join(tmpDir, "bin-"));
    const exe = path.join(dir, "alat-kecil");
    fs.writeFileSync(exe, "#!/bin/sh\nexit 0\n");
    fs.chmodSync(exe, 0o755);
    expect(findOnPath("alat-kecil", dir)).toBe(exe);
  });
});
