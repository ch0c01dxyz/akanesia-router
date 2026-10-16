/**
 * Supervisor for opencode2 serve subprocess (bridge mode).
 *
 * Starts `opencode2 serve` on demand, captures the Basic auth password from
 * its log output, and kills the process when the main server shuts down.
 *
 * Egar uses opencode2 (not opencode v1). Binary: ~/.opencode/bin/opencode2
 */

import { spawn } from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";

const BRIDGE_PORT = 4096;
const BRIDGE_HOST = "127.0.0.1";

let proc = null;
let password = null;
let startPromise = null;

function binaryPath() {
  // Bun shim exes are path-locked (remap into node_modules relative to their own
  // location) — must run from ~/.bun/bin, a copy elsewhere exits 255.
  return join(homedir(), ".bun", "bin", "opencode2.exe");
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

function doStart() {
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
