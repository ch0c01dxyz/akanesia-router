import fs from "fs";
import path from "path";
import { spawn } from "child_process";
import { DATA_DIR } from "@/lib/dataDir.js";
import { findHeadroomBinary, findPython310, findUvBinary, findUvToolPython, getHeadroomInstallKind, HEADROOM_COMPRESSION_EXTRAS, EXTRA_MARKERS, getInstalledHeadroomExtras, invalidateHeadroomStatusCache } from "./detect.js";
import { IS_WINDOWS } from "../platform.js";

const HEADROOM_DIR = path.join(DATA_DIR, "headroom");
const PID_FILE = path.join(HEADROOM_DIR, "proxy.pid");
const LOG_FILE = path.join(HEADROOM_DIR, "proxy.log");
const INSTALL_LOG_FILE = path.join(HEADROOM_DIR, "install.log");
const DEFAULT_PORT = 8787;
const STARTUP_TIMEOUT_MS = 8000;

function ensureDir() {
  if (!fs.existsSync(HEADROOM_DIR)) fs.mkdirSync(HEADROOM_DIR, { recursive: true });
}

function readPid() {
  try {
    if (fs.existsSync(PID_FILE)) return parseInt(fs.readFileSync(PID_FILE, "utf8"), 10);
  } catch { /* ignore */ }
  return null;
}

function writePid(pid) {
  ensureDir();
  fs.writeFileSync(PID_FILE, String(pid));
}

function clearPid() {
  try { if (fs.existsSync(PID_FILE)) fs.unlinkSync(PID_FILE); } catch { /* ignore */ }
}

// process.kill throws if pid is dead — use this to probe.
export function isPidAlive(pid) {
  if (!pid || typeof pid !== "number") return false;
  try { process.kill(pid, 0); return true; } catch { return false; }
}

export function getManagedPid() {
  const pid = readPid();
  return pid && isPidAlive(pid) ? pid : null;
}

// Build proxy CLI flags for the active compression extras. `[code]` (AST
// compression) is off by default in headroom → pass --code-aware to turn it on;
// `[ml]` (Kompress) is on by default → pass --disable-kompress to turn it off.
function extrasProxyArgs({ codeAware, kompress } = {}) {
  const args = [];
  if (codeAware) args.push("--code-aware");
  if (kompress === false) args.push("--disable-kompress");
  return args;
}

export async function startHeadroomProxy({ port = DEFAULT_PORT, codeAware = false, kompress = true } = {}) {
  const safePort = Number(port) > 0 && Number(port) < 65536 ? Number(port) : DEFAULT_PORT;
  const binary = await findHeadroomBinary();
  if (!binary) {
    const err = new Error("Headroom CLI not installed");
    err.code = "NOT_INSTALLED";
    throw err;
  }

  const existing = getManagedPid();
  if (existing) return { pid: existing, alreadyRunning: true };

  ensureDir();
  // spawn stdio requires fd numbers, not WriteStream objects.
  const outFd = fs.openSync(LOG_FILE, "a");

  const args = ["proxy", "--port", String(safePort), ...extrasProxyArgs({ codeAware, kompress })];
  // .bat/.cmd shims (e.g. pyenv-win, `uv tool install` on Windows) need the
  // shell — CreateProcess cannot run them directly.
  const needsShell = IS_WINDOWS && /\.(bat|cmd)$/i.test(binary);
  const child = spawn(binary, args, {
    stdio: ["ignore", outFd, outFd],
    detached: true,
    windowsHide: true,
    shell: needsShell,
    env: { ...process.env },
  });

  if (!child.pid) {
    fs.closeSync(outFd);
    const err = new Error("Failed to spawn headroom proxy");
    err.code = "SPAWN_FAILED";
    throw err;
  }

  child.unref();
  writePid(child.pid);

  // The fd must be closed exactly once: closing an already-closed fd throws
  // EBADF, which previously surfaced as an uncaughtException when the proxy
  // exited later (the startup "exit" listener was never removed).
  let outFdClosed = false;
  const closeOutFd = () => {
    if (outFdClosed) return;
    outFdClosed = true;
    try { fs.closeSync(outFd); } catch { /* already closed */ }
  };

  // Wait until the process either stays alive briefly (success) or exits fast (failure).
  await new Promise((resolve, reject) => {
    const onExit = (code) => {
      clearTimeout(startupTimer);
      clearPid();
      closeOutFd();
      const e = new Error(`headroom proxy exited early (code=${code}) — see proxy.log`);
      e.code = "EARLY_EXIT";
      reject(e);
    };
    const startupTimer = setTimeout(() => {
      // Startup phase is over — detach the listener so a later exit of the
      // long-lived proxy can never touch outFd again.
      child.off("exit", onExit);
      if (isPidAlive(child.pid)) resolve();
      else {
        closeOutFd();
        reject(new Error("headroom proxy exited during startup — see proxy.log"));
      }
    }, STARTUP_TIMEOUT_MS);

    child.once("exit", onExit);
  });

  // Close parent's copy of the fd; child retains its own after unref.
  closeOutFd();

  // The process staying alive is not enough: the Python proxy needs a few
  // seconds to boot and bind the port (longer on low-spec devices). Wait
  // until /health is actually reachable so callers (and the UI refresh right
  // after) see a consistent running=true state instead of a stale "Stopped".
  const healthUrl = `http://127.0.0.1:${safePort}/health`;
  const deadline = Date.now() + 90000;
  for (;;) {
    if (!isPidAlive(child.pid)) {
      clearPid();
      const e = new Error("headroom proxy exited during startup — see proxy.log");
      e.code = "EARLY_EXIT";
      throw e;
    }
    try {
      const res = await fetch(healthUrl, { signal: AbortSignal.timeout(2000) });
      // Drain the body so the socket can be reused/closed cleanly.
      await res.arrayBuffer().catch(() => {});
      if (res.ok || res.status === 404) break;
    } catch { /* not up yet — keep polling */ }
    if (Date.now() >= deadline) {
      const e = new Error(
        `headroom proxy did not become reachable at ${healthUrl} within 90s — see proxy.log`
      );
      e.code = "HEALTH_TIMEOUT";
      throw e;
    }
    await new Promise((r) => setTimeout(r, 250));
  }

  return { pid: child.pid, alreadyRunning: false };
}

export function stopHeadroomProxy() {
  const pid = getManagedPid();
  if (!pid) return { stopped: false, reason: "not_running" };
  try {
    process.kill(pid, "SIGTERM");
    // Give it a moment, then force if still alive.
    setTimeout(() => {
      if (isPidAlive(pid)) {
        try { process.kill(pid, "SIGKILL"); } catch { /* already gone */ }
      }
    }, 2000);
    clearPid();
    return { stopped: true, pid };
  } catch (e) {
    clearPid();
    const err = new Error(`Failed to stop headroom proxy: ${e.message}`);
    err.code = "STOP_FAILED";
    throw err;
  }
}

// Stop the managed proxy (if any), wait for the pid to die, then start again
// with the given flags. Used when toggling active extras that require a restart.
export async function restartHeadroomProxy(opts = {}) {
  const pid = getManagedPid();
  if (pid) {
    try { process.kill(pid, "SIGTERM"); } catch { /* already gone */ }
    // Wait up to ~3s for graceful exit, force-kill if still alive.
    for (let i = 0; i < 30 && isPidAlive(pid); i++) {
      await new Promise((r) => setTimeout(r, 100));
    }
    if (isPidAlive(pid)) {
      try { process.kill(pid, "SIGKILL"); } catch { /* already gone */ }
      await new Promise((r) => setTimeout(r, 300));
    }
    clearPid();
  }
  return startHeadroomProxy(opts);
}

export function getHeadroomLogTail(maxLines = 200) {
  try {
    if (!fs.existsSync(LOG_FILE)) return "";
    const content = fs.readFileSync(LOG_FILE, "utf8");
    const lines = content.split(/\r?\n/).filter(Boolean);
    return lines.slice(-maxLines).join("\n");
  } catch { return ""; }
}

// Install (or upgrade) headroom-ai with the requested compression extras.
// `extras` is a whitelist from HEADROOM_COMPRESSION_EXTRAS — anything else
// is rejected to keep the install surface predictable. Always installs the
// `proxy` base + whatever extras the user picked, regardless of what is
// already present.
//
// The installer matches how headroom-ai was originally installed:
// - uv-managed (`uv tool install "headroom-ai[all]"`) → `uv tool install --force`
// - pip-managed → `python -m pip install --upgrade`
// - fresh install → prefers `uv` when available, falls back to pip.
export async function installHeadroomExtras(extras = []) {
  const requested = Array.isArray(extras) ? extras.filter((e) => HEADROOM_COMPRESSION_EXTRAS.includes(e)) : [];
  // pip install string is built from a closed set (HEADROOM_COMPRESSION_EXTRAS),
  // so it cannot be poisoned by caller input — the comma-list is a fixed
  // ['proxy', ...requested]. No shell interpolation.
  const extrasList = ["proxy", ...requested].join(",");
  const spec = `headroom-ai[${extrasList}]`;

  const kind = await getHeadroomInstallKind();
  if (kind === "uv" || (!kind && (await findUvBinary()))) {
    return runUvToolInstall(spec, requested);
  }

  const py = await findPython310();
  if (!py) {
    const err = new Error("Python >= 3.10 not found and `uv` is not available");
    err.code = "NO_PYTHON";
    throw err;
  }
  const args = ["-m", "pip", "install", "--upgrade", spec];

  ensureDir();
  // Truncate ("w") so the log reflects only the current install for live progress.
  const outFd = fs.openSync(INSTALL_LOG_FILE, "w");
  const child = spawn(py, args, {
    stdio: ["ignore", outFd, outFd],
    windowsHide: true,
    env: { ...process.env },
  });

  return new Promise((resolve, reject) => {
    child.once("error", (e) => { fs.closeSync(outFd); reject(e); });
    child.once("exit", async (code) => {
      fs.closeSync(outFd);
      if (code === 0) {
        const status = await getInstalledHeadroomExtras(py);
        invalidateHeadroomStatusCache();
        resolve({ success: true, code, spec, extras: requested, via: "pip", ...status });
      } else {
        const err = new Error(`pip install exited with code=${code} — see headroom/install.log`);
        err.code = "INSTALL_FAILED";
        reject(err);
      }
    });
  });
}

// `uv tool install` is atomic per tool: reinstalling with `--force` and the
// desired extras set is the supported way to add/remove extras.
async function runUvToolInstall(spec, requested) {
  const uv = await findUvBinary();
  if (!uv) {
    const err = new Error("`uv` not found");
    err.code = "NO_UV";
    throw err;
  }
  const args = ["tool", "install", "--force", spec];

  ensureDir();
  const outFd = fs.openSync(INSTALL_LOG_FILE, "w");
  const child = spawn(uv, args, {
    stdio: ["ignore", outFd, outFd],
    windowsHide: true,
    env: { ...process.env },
  });

  return new Promise((resolve, reject) => {
    child.once("error", (e) => { fs.closeSync(outFd); reject(e); });
    child.once("exit", async (code) => {
      fs.closeSync(outFd);
      if (code === 0) {
        const status = await getInstalledHeadroomExtras(findUvToolPython());
        invalidateHeadroomStatusCache();
        resolve({ success: true, code, spec, extras: requested, via: "uv", ...status });
      } else {
        const err = new Error(`uv tool install exited with code=${code} — see headroom/install.log`);
        err.code = "INSTALL_FAILED";
        reject(err);
      }
    });
  });
}

// Uninstall the marker packages that back a single extra (e.g. `ml` → torch,
// huggingface-hub). `headroom-ai` base and the `proxy` extra are never removed.
//
// For uv-managed installs this reinstalls the tool without the removed extras
// (`uv tool install` is atomic — individual packages can't be uninstalled).
export async function uninstallHeadroomExtras(extras = []) {
  const requested = Array.isArray(extras) ? extras.filter((e) => HEADROOM_COMPRESSION_EXTRAS.includes(e)) : [];
  const kind = await getHeadroomInstallKind();
  if (kind === "uv") {
    const current = await getInstalledHeadroomExtras(findUvToolPython());
    const keep = HEADROOM_COMPRESSION_EXTRAS.filter((e) => current.extras?.[e] && !requested.includes(e));
    const extrasList = ["proxy", ...keep].join(",");
    return runUvToolInstall(`headroom-ai[${extrasList}]`, keep);
  }
  const py = await findPython310();
  if (!py) {
    const err = new Error("Python >= 3.10 not found");
    err.code = "NO_PYTHON";
    throw err;
  }
  const pkgs = [...new Set(requested.flatMap((e) => EXTRA_MARKERS[e] || []))];
  if (pkgs.length === 0) {
    const err = new Error("No valid extras to remove");
    err.code = "INVALID_EXTRAS";
    throw err;
  }
  const args = ["-m", "pip", "uninstall", "-y", ...pkgs];

  ensureDir();
  const outFd = fs.openSync(INSTALL_LOG_FILE, "w");
  const child = spawn(py, args, {
    stdio: ["ignore", outFd, outFd],
    windowsHide: true,
    env: { ...process.env },
  });

  return new Promise((resolve, reject) => {
    child.once("error", (e) => { fs.closeSync(outFd); reject(e); });
    child.once("exit", async (code) => {
      fs.closeSync(outFd);
      if (code === 0) {
        const status = await getInstalledHeadroomExtras(py);
        invalidateHeadroomStatusCache();
        resolve({ success: true, code, removed: pkgs, extras: requested, ...status });
      } else {
        const err = new Error(`pip uninstall exited with code=${code} — see headroom/install.log`);
        err.code = "UNINSTALL_FAILED";
        reject(err);
      }
    });
  });
}

// Read the tail of the install/uninstall log for live progress in the UI.
export function getInstallLogTail(maxLines = 15) {
  try {
    if (!fs.existsSync(INSTALL_LOG_FILE)) return "";
    const lines = fs.readFileSync(INSTALL_LOG_FILE, "utf8").split(/\r?\n/).filter(Boolean);
    return lines.slice(-maxLines).join("\n");
  } catch { return ""; }
}
