/**
 * Supervisor for opencode2 serve subprocess (bridge mode).
 *
 * Starts `opencode2 serve` on demand, captures the Basic auth password from
 * its log output, and kills the process when the main server shuts down.
 *
 * Egar uses opencode2 (not opencode v1). Binary: ~/.opencode/bin/opencode2
 */

import { spawn, execFile } from "node:child_process";
import { homedir, platform } from "node:os";
import { join } from "node:path";
import { createConnection } from "node:net";
import { existsSync } from "node:fs";

const BRIDGE_PORT = 4096;
const BRIDGE_HOST = "127.0.0.1";

let proc = null;
let password = null;
let startPromise = null;

/**
 * Cek apakah opencode2 terinstall. Return { installed, path, version }.
 */
export async function checkOpencodeInstalled() {
  const bin = binaryPath();
  if (!existsSync(bin)) {
    return { installed: false, path: bin, version: null, os: platform() };
  }
  // Ambil versi
  const version = await new Promise((resolve) => {
    execFile(bin, ["--version"], { timeout: 5000 }, (err, stdout) => {
      if (err) return resolve(null);
      const m = String(stdout).match(/(\d+\.\d+\.\d+)/);
      resolve(m ? m[1] : String(stdout).trim().slice(0, 20));
    });
  });
  return { installed: true, path: bin, version, os: platform() };
}

/**
 * Panduan install per OS untuk ditampilkan di modal dashboard.
 */
export function getSetupGuide() {
  const os = platform();
  if (os === "win32") {
    return {
      os: "windows",
      title: "Install opencode2 di Windows",
      steps: [
        "Install Bun: buka PowerShell dan jalankan: irm bun.sh/install.ps1 | iex",
        "Restart terminal, lalu jalankan: bun install -g opencode2",
        "Pastikan ~/.bun/bin ada di PATH",
        "Restart akanesia-router",
      ],
    };
  }
  if (os === "darwin") {
    return {
      os: "macos",
      title: "Install opencode2 di macOS",
      steps: [
        "Buka Terminal dan jalankan:",
        "curl -fsSL https://opencode.ai/install | bash",
        "Pastikan ~/.opencode/bin ada di PATH",
        "Restart akanesia-router",
      ],
    };
  }
  return {
    os: "linux",
    title: "Install opencode2 di Linux",
    steps: [
      "Buka terminal dan jalankan:",
      "curl -fsSL https://opencode.ai/install | bash",
      "Pastikan ~/.opencode/bin ada di PATH",
      "Restart akanesia-router",
    ],
  };
}

/**
 * OS-aware binary path untuk opencode2.
 * - Windows: ~/.bun/bin/opencode2.exe (bun shim path-locked, harus dari sini)
 * - Linux/macOS: ~/.opencode/bin/opencode2 (install standar)
 */
function binaryPath() {
  const os = platform();
  if (os === "win32") {
    // Bun shim exes are path-locked (remap into node_modules relative to their own
    // location) — must run from ~/.bun/bin, a copy elsewhere exits 255.
    return join(homedir(), ".bun", "bin", "opencode2.exe");
  }
  // Linux/macOS: install standar via curl script
  return join(homedir(), ".opencode", "bin", "opencode2");
}

/**
 * Probe apakah port bridge sudah dipakai (orphan serve dari crash sebelumnya).
 * Return true jika ada yang listen di BRIDGE_PORT.
 */
function isPortInUse() {
  return new Promise((resolve) => {
    const socket = createConnection({ host: BRIDGE_HOST, port: BRIDGE_PORT });
    socket.on("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.on("error", () => {
      socket.destroy();
      resolve(false);
    });
    // Timeout 2 detik
    socket.setTimeout(2000);
    socket.on("timeout", () => {
      socket.destroy();
      resolve(false);
    });
  });
}

/**
 * Start the serve process if not running. Returns { baseUrl, password }.
 * Safe to call concurrently (singleflight).
 */
export async function ensureBridgeRunning() {
  if (proc && password) {
    return { baseUrl: `http://${BRIDGE_HOST}:${BRIDGE_PORT}`, password };
  }
  if (startPromise) return startPromise;
  startPromise = doStart();
  try {
    return await startPromise;
  } finally {
    startPromise = null;
  }
}

async function doStart() {
  // Guard: jika ada orphan serve yang masih jalan (router crash sebelumnya),
  // jangan spawn baru — pakai yang sudah ada.
  if (await isPortInUse()) {
    console.log(`[opencode-bridge] Port ${BRIDGE_PORT} sudah dipakai (orphan serve?), pakai yang ada.`);
    // Password tidak diketahui untuk orphan — coba tanpa auth dulu,
    // atau user harus bunuh manual jika auth gagal.
    return { baseUrl: `http://${BRIDGE_HOST}:${BRIDGE_PORT}`, password: null };
  }

  return new Promise((resolve, reject) => {
    const bin = binaryPath();
    const childProc = spawn(bin, ["serve", "--port", String(BRIDGE_PORT), "--hostname", BRIDGE_HOST], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    proc = childProc;

    let output = "";
    let resolved = false;
    const onData = (data) => {
      output += data.toString();
      // Password line: "server password <password>"
      const m = output.match(/server password (\S+)/);
      if (m && !resolved) {
        resolved = true;
        password = m[1];
        childProc.stdout.off("data", onData);
        childProc.stderr.off("data", onData);
        resolve({ baseUrl: `http://${BRIDGE_HOST}:${BRIDGE_PORT}`, password });
      }
    };
    childProc.stdout.on("data", onData);
    childProc.stderr.on("data", onData);

    childProc.on("error", (err) => {
      if (!resolved) {
        proc = null;
        reject(new Error(`opencode2 serve failed to start: ${err.message}`));
      }
    });

    childProc.on("exit", (code) => {
      // If we haven't resolved yet, it failed to start
      if (!resolved) {
        proc = null;
        reject(new Error(`opencode2 serve exited with code ${code}`));
      } else {
        // Was running, now died — clear state so next call restarts
        proc = null;
        password = null;
      }
    });

    // Timeout after 15s
    setTimeout(() => {
      if (!resolved) {
        try { childProc.kill(); } catch {}
        proc = null;
        reject(new Error("opencode2 serve start timeout (no password in output)"));
      }
    }, 15000);
  });
}

/**
 * Kill the serve process. Called on main server shutdown.
 */
export function killBridge() {
  if (proc) {
    try {
      proc.kill("SIGTERM");
      // Force kill after 5s if still alive
      setTimeout(() => {
        try { proc.kill("SIGKILL"); } catch {}
      }, 5000);
    } catch {}
    proc = null;
    password = null;
  }
}

/**
 * Check if bridge is currently running.
 */
export function isBridgeRunning() {
  return !!(proc && password);
}

// Hook into main process shutdown — bridge dies with akanesia-router.
process.on("SIGINT", killBridge);
process.on("SIGTERM", killBridge);
process.on("exit", killBridge);
