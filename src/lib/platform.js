// Deteksi environment (Windows / macOS / Linux) + validasi executable.
//
// Latar bug: membuka halaman Token Saver memicu dialog "Open with" di
// Windows 11. Penyebab: kandidat binary di-probe lewat execSync(string),
// yang di Windows berjalan via cmd.exe — dan cmd.exe mengeksekusi file lewat
// mekanisme asosiasi ekstensi Windows. File tanpa ekstensi yang dikenal
// (mis. pyenv shim berisi `#!/bin/sh`) membuat Windows menampilkan dialog
// "How do you want to open this file?".
//
// Aturan aman yang dipakai modul ini:
// 1. Jangan pernah mengeksekusi kandidat lewat shell, kecuali ekstensinya
//    memang tipe script Windows (.bat/.cmd) yang selalu terasosiasi.
// 2. Tolak file yang bukan executable di platform aktif *sebelum* dipakai:
//    di Windows, file tanpa ekstensi PATHEXT bukan executable.

import { execFile, execFileSync } from "child_process";
import { promisify } from "util";
import fs from "fs";
import path from "path";

const execFileAsync = promisify(execFile);

// "windows" | "macos" | "linux".
// `process.platform` win32 → windows, darwin → macos,
// linux (dan unix-like lain) → linux.
export function getOsKind() {
  const p = process.platform;
  if (p === "win32") return "windows";
  if (p === "darwin") return "macos";
  return "linux";
}

export const IS_WINDOWS = getOsKind() === "windows";
export const IS_MACOS = getOsKind() === "macos";
export const IS_LINUX = getOsKind() === "linux";

// Daftar ekstensi executable Windows dari PATHEXT (lowercase, pakai titik).
export function windowsExecutableExtensions() {
  const raw = process.env.PATHEXT || ".COM;.EXE;.BAT;.CMD";
  return raw
    .split(";")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

// Apakah `p` executable di platform SAAT INI?
// - Windows: file harus ada + ekstensinya masuk PATHEXT.
// - macOS/Linux: file harus ada + punya execute bit (X_OK).
export function isExecutablePath(p) {
  if (!p || typeof p !== "string") return false;
  try {
    if (!fs.statSync(p).isFile()) return false;
  } catch {
    return false;
  }
  if (IS_WINDOWS) {
    return windowsExecutableExtensions().includes(path.extname(p).toLowerCase());
  }
  try {
    fs.accessSync(p, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

// Jalankan `bin` dengan `args` TANPA shell; true bila exit code 0.
// Tanpa shell, Windows tidak pernah konsultasi asosiasi file, sehingga file
// yang tidak bisa dijalankan gagal diam-diam (throw → false) alih-alih
// memunculkan dialog "Open with".
// Pengecualian: `.bat`/`.cmd` di Windows memang butuh shell (CreateProcess
// tidak memahaminya) — kedua ekstensi itu selalu terasosiasi ke cmd.exe,
// jadi aman.
export function probeRun(bin, args = [], timeoutMs = 8000) {
  if (!isExecutablePath(bin)) return false;
  try {
    const needsShell = IS_WINDOWS && /\.(bat|cmd)$/i.test(bin);
    execFileSync(bin, args, {
      stdio: ["ignore", "pipe", "ignore"],
      windowsHide: true,
      timeout: timeoutMs,
      shell: needsShell,
    });
    return true;
  } catch {
    return false;
  }
}

// Cari `name` via `where` (Windows) / `which` (macOS/Linux); `extraPath`
// di-prepend ke PATH agar direktori tambahan (mis. ~/.local/bin) ikut
// dicari tanpa menghilangkan system dirs. Mengembalikan hit pertama yang
// lolos isExecutablePath, atau null. Tidak seperti `where`/`which` mentah,
// hasilnya dijamin executable di platform aktif.
export function findOnPath(name, extraPath) {
  if (!name || typeof name !== "string") return null;
  const cmd = IS_WINDOWS ? "where" : "which";
  const searchPath = extraPath
    ? [extraPath, process.env.PATH || ""].filter(Boolean).join(path.delimiter)
    : process.env.PATH || "";
  try {
    const out = execFileSync(cmd, [name], {
      stdio: ["ignore", "pipe", "ignore"],
      windowsHide: true,
      timeout: 8000,
      env: { ...process.env, PATH: searchPath },
    })
      .toString()
      .trim();
    // `where` bisa mengembalikan beberapa baris — ambil yang pertama.
    const first = out ? out.split(/\r?\n/)[0].trim() : null;
    return first && isExecutablePath(first) ? first : null;
  } catch {
    return null;
  }
}

// Jalankan `file` dengan `args` dan kembalikan stdout (trim), atau null bila
// gagal/timeout. Versi async dari pola execFileSync(...).toString() —
// tidak memblokir event loop Node.
export async function execFileOutputAsync(file, args = [], timeoutMs = 8000, extraEnv) {
  try {
    const { stdout } = await execFileAsync(file, args, {
      stdio: ["ignore", "pipe", "ignore"],
      windowsHide: true,
      timeout: timeoutMs,
      env: extraEnv || process.env,
    });
    return String(stdout ?? "").trim();
  } catch {
    return null;
  }
}

// Versi async dari probeRun: tidak memblokir event loop. Dipakai di jalur
// request (mis. /api/headroom/status, /api/headroom/extras) supaya halaman
// lain tetap bisa diakses selama deteksi binary berjalan — versi sync-nya
// menahan seluruh server Node selama probing (di Windows bisa belasan detik).
export async function probeRunAsync(bin, args = [], timeoutMs = 8000) {
  if (!isExecutablePath(bin)) return false;
  try {
    const needsShell = IS_WINDOWS && /\.(bat|cmd)$/i.test(bin);
    await execFileAsync(bin, args, {
      stdio: ["ignore", "pipe", "ignore"],
      windowsHide: true,
      timeout: timeoutMs,
      shell: needsShell,
    });
    return true;
  } catch {
    return false;
  }
}

// Versi async dari findOnPath: tidak memblokir event loop.
export async function findOnPathAsync(name, extraPath) {
  if (!name || typeof name !== "string") return null;
  const cmd = IS_WINDOWS ? "where" : "which";
  const searchPath = extraPath
    ? [extraPath, process.env.PATH || ""].filter(Boolean).join(path.delimiter)
    : process.env.PATH || "";
  try {
    const { stdout } = await execFileAsync(cmd, [name], {
      stdio: ["ignore", "pipe", "ignore"],
      windowsHide: true,
      timeout: 8000,
      env: { ...process.env, PATH: searchPath },
    });
    // `where` bisa mengembalikan beberapa baris — ambil yang pertama.
    const first = String(stdout ?? "").trim().split(/\r?\n/)[0].trim();
    return first && isExecutablePath(first) ? first : null;
  } catch {
    return null;
  }
}
