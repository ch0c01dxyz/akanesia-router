import { execFileSync, execSync } from "child_process";
import fs from "fs";
import path from "path";

// Extras that improve headroom compression quality. `proxy` is the base;
// `code` adds tree-sitter AST compression; `ml` adds Kompress-v2 HF model.
// Other `[all]` extras (image, voice, otel, reports, evals, ...) are not
// useful for the 9router proxy use case, so we don't track them here.
export const HEADROOM_COMPRESSION_EXTRAS = ["code", "ml"];

// Marker packages that each extra pulls in. Detected from `pip list --format=json`
// so one call can answer both the installed version and active extras.
export const EXTRA_MARKERS = {
  code: ["tree-sitter", "tree-sitter-language-pack"],
  ml: ["torch", "huggingface-hub"],
};

const HEADROOM_PIP_TIMEOUT_MS = 8000;

const IS_WIN = process.platform === "win32";
const WHICH_CMD = IS_WIN ? "where" : "which";

// uv binary/shim locations. `uv tool install` puts the `headroom` shim in
// `%USERPROFILE%\.local\bin` (Windows) or `~/.local/bin` — these are often
// missing from a service/packaged PATH, so probe them explicitly.
const UV_BIN_DIR = IS_WIN
  ? path.join(process.env.USERPROFILE || "", ".local", "bin")
  : path.join(process.env.HOME || "", ".local", "bin");

function uvToolsDir() {
  if (process.env.UV_TOOL_DIR) return process.env.UV_TOOL_DIR;
  return IS_WIN
    ? path.join(process.env.APPDATA || "", "uv", "tools")
    : path.join(process.env.HOME || "", ".local", "share", "uv", "tools");
}

// Extra bin dirs often missing from a packaged/launchd PATH (Python installs headroom here).
const EXTRA_BINS = IS_WIN
  ? [
      UV_BIN_DIR,
      `${process.env.LOCALAPPDATA || ""}\\Programs\\Python\\Python313\\Scripts`,
      `${process.env.LOCALAPPDATA || ""}\\Programs\\Python\\Python312\\Scripts`,
      `${process.env.LOCALAPPDATA || ""}\\Programs\\Python\\Python311\\Scripts`,
      `${process.env.LOCALAPPDATA || ""}\\Programs\\Python\\Python310\\Scripts`,
      `${process.env.APPDATA || ""}\\Python\\Python313\\Scripts`,
    ]
  : [
      UV_BIN_DIR,
      "/usr/local/bin",
      "/opt/homebrew/bin",
      "/Library/Frameworks/Python.framework/Versions/3.13/bin",
      "/Library/Frameworks/Python.framework/Versions/3.12/bin",
      "/Library/Frameworks/Python.framework/Versions/3.11/bin",
      "/Library/Frameworks/Python.framework/Versions/3.10/bin",
      `${process.env.HOME || ""}/.local/bin`,
      "/usr/bin",
      "/bin",
    ];

const EXTENDED_PATH = [...EXTRA_BINS, process.env.PATH || ""].filter(Boolean).join(path.delimiter);
const PYTHON_CANDIDATES = ["python3.13", "python3.12", "python3.11", "python3.10", "python3", "python"];
const MIN_VERSION = [3, 10];
const HEADROOM_HEALTH_TIMEOUT_MS = 1500;
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]", "0.0.0.0"]);

export const DEFAULT_HEADROOM_URL = process.env.HEADROOM_URL || "http://localhost:8787";

// Detect whether the headroom CLI is installed and where its binary lives.
export function findHeadroomBinary() {
  try {
    const out = execSync(`${WHICH_CMD} headroom`, {
      stdio: ["ignore", "pipe", "ignore"],
      windowsHide: true,
      env: { ...process.env, PATH: EXTENDED_PATH },
    }).toString().trim();
    // Windows `where` may return multiple lines — take the first.
    return out ? out.split(/\r?\n/)[0].trim() : null;
  } catch {
    return null;
  }
}

// Find the `uv` binary (used for uv-managed headroom installs).
export function findUvBinary() {
  try {
    const out = execSync(`${WHICH_CMD} uv`, {
      stdio: ["ignore", "pipe", "ignore"],
      windowsHide: true,
      env: { ...process.env, PATH: EXTENDED_PATH },
    }).toString().trim();
    return out ? out.split(/\r?\n/)[0].trim() : null;
  } catch {
    return null;
  }
}

// Python inside uv's isolated tool venv for headroom-ai
// (`uv tool install "headroom-ai[all]"`). Returns null when not present.
export function findUvToolPython() {
  const venvPy = IS_WIN
    ? path.join(uvToolsDir(), "headroom-ai", "Scripts", "python.exe")
    : path.join(uvToolsDir(), "headroom-ai", "bin", "python");
  try {
    if (fs.existsSync(venvPy)) return venvPy;
  } catch { /* ignore */ }
  return null;
}

// How headroom-ai was installed: "uv" (uv tool venv), "pip" (visible to a
// system python via pip), or null (not installed).
export function getHeadroomInstallKind() {
  if (findUvToolPython()) return "uv";
  const py = findPython310();
  if (py) {
    try {
      execFileSync(py, ["-m", "pip", "show", "headroom-ai"], {
        stdio: ["ignore", "pipe", "ignore"],
        windowsHide: true,
        timeout: HEADROOM_PIP_TIMEOUT_MS,
        env: { ...process.env, PATH: EXTENDED_PATH },
      });
      return "pip";
    } catch { /* not visible to this python */ }
  }
  // Binary exists but package not visible to any probed python (e.g. pipx,
  // conda env not on PATH) — treat as pip-style for marker probing fallback.
  if (findHeadroomBinary()) return "pip";
  return null;
}

// Find a Python interpreter >= 3.10 (headroom-ai requires it). Returns null if none.
// `python3`, `python3.13`, `python` can point at different envs on any OS. Prefer
// the interpreter that can also see the installed `headroom-ai` package so the
// dashboard probes and install action operate on the same interpreter as the CLI.
// Falls back to the first version-eligible candidate when headroom-ai is not yet
// installed anywhere (needed for the initial install).
// Interpreters to probe, most specific first: the python next to the headroom
// binary (guaranteed to have headroom-ai), then full paths from EXTRA_BINS, then
// bare names resolved via PATH.
function pythonCandidates() {
  const list = [];
  const bin = findHeadroomBinary();
  if (bin) {
    const dir = path.dirname(bin);
    const names = IS_WIN ? ["python.exe", "python3.exe"] : ["python3", "python3.13", "python"];
    for (const n of names) list.push(path.join(dir, n));
  }
  for (const dir of EXTRA_BINS) {
    if (!dir) continue;
    for (const n of PYTHON_CANDIDATES) list.push(path.join(dir, IS_WIN ? `${n}.exe` : n));
  }
  list.push(...PYTHON_CANDIDATES);
  return list;
}

export function findPython310() {
  let fallback = null;
  for (const candidate of pythonCandidates()) {
    try {
      const ver = execSync(`${candidate} --version`, {
        stdio: ["ignore", "pipe", "ignore"],
        windowsHide: true,
        env: { ...process.env, PATH: EXTENDED_PATH },
      }).toString().trim();
      const match = ver.match(/(\d+)\.(\d+)/);
      if (!match) continue;
      const [major, minor] = [parseInt(match[1], 10), parseInt(match[2], 10)];
      if (!(major > MIN_VERSION[0] || (major === MIN_VERSION[0] && minor >= MIN_VERSION[1]))) continue;
      if (!fallback) fallback = candidate;
      try {
        execFileSync(candidate, ["-m", "pip", "show", "headroom-ai"], {
          stdio: ["ignore", "pipe", "ignore"],
          windowsHide: true,
          timeout: HEADROOM_PIP_TIMEOUT_MS,
          env: { ...process.env, PATH: EXTENDED_PATH },
        });
        return candidate;
      } catch {
        // Keep scanning until an interpreter that sees headroom-ai is found.
      }
    } catch {
      // candidate not present, try next
    }
  }
  return fallback;
}

// Probe whether a Headroom proxy is reachable at the given URL by hitting /health.
export async function probeProxyRunning(url) {
  if (!url) return false;
  const base = String(url).replace(/\/$/, "");
  try {
    const res = await fetch(`${base}/health`, { signal: AbortSignal.timeout(HEADROOM_HEALTH_TIMEOUT_MS) });
    return res.ok;
  } catch {
    return false;
  }
}

export function isLoopbackHeadroomUrl(url) {
  try {
    const parsed = new URL(url);
    return LOOPBACK_HOSTS.has(parsed.hostname);
  } catch {
    return false;
  }
}

// Aggregate status for the dashboard: installed, running, python interpreter.
export async function getHeadroomStatus(url) {
  const path = findHeadroomBinary();
  const python = findPython310();
  const uvPy = findUvToolPython();
  const installed = Boolean(path) || Boolean(uvPy);
  const running = await probeProxyRunning(url);
  const localUrl = isLoopbackHeadroomUrl(url);
  const extrasStatus = installed ? getInstalledHeadroomExtras(python) : { installed: false, version: null, extras: { code: false, ml: false }, via: null };
  return {
    installed,
    path,
    running,
    python: uvPy || python,
    localUrl,
    canStart: installed && localUrl,
    version: extrasStatus.version,
    extras: extrasStatus.extras,
    via: extrasStatus.via || null,
  };
}

// Parse installed headroom-ai version + which compression extras are
// actually installed (detected via marker package presence). One `pip list`
// call is enough to answer both questions.
//
// For `uv tool install` setups the package lives in uv's isolated tool venv,
// invisible to system pythons — so probe the uv venv python first.
//
// Returns: { installed: bool, version: string|null, extras: { code, ml }, via: "uv"|"pip"|null }
export function getInstalledHeadroomExtras(python) {
  // 1) uv-managed install: probe the isolated tool venv directly.
  const uvPy = findUvToolPython();
  if (uvPy) {
    const st = probeExtrasViaPython(uvPy);
    if (st.installed) return { ...st, via: "uv" };
  }
  // 2) pip-managed install: probe the given/found system python.
  const py = python || findPython310();
  if (!py) return { installed: false, version: null, extras: { code: false, ml: false }, via: null };
  const pipStatus = probeExtrasViaPython(py);
  return { ...pipStatus, via: pipStatus.installed ? "pip" : null };
}

function emptyExtrasStatus() {
  return { installed: false, version: null, extras: { code: false, ml: false } };
}

function probeExtrasViaPython(py) {
  try {
    const out = execFileSync(py, ["-m", "pip", "list", "--format=json", "--disable-pip-version-check"], {
      stdio: ["ignore", "pipe", "ignore"],
      windowsHide: true,
      timeout: HEADROOM_PIP_TIMEOUT_MS,
      env: { ...process.env, PATH: EXTENDED_PATH },
    }).toString();
    const packages = JSON.parse(out);
    const names = new Set(packages.map((p) => String(p.name || "").toLowerCase()));
    const installed = names.has("headroom-ai");
    if (!installed) return emptyExtrasStatus();
    const version = packages.find((p) => p.name?.toLowerCase() === "headroom-ai")?.version || null;
    const extras = {};
    for (const extra of HEADROOM_COMPRESSION_EXTRAS) {
      extras[extra] = EXTRA_MARKERS[extra].some((m) => names.has(m));
    }
    return { installed: true, version, extras };
  } catch {
    // pip may be missing in the venv — fall back to import probing.
    return probeExtrasViaImport(py);
  }
}

// Fallback when `pip` is unavailable: check marker packages via import.
function probeExtrasViaImport(py) {
  const check = (mod) => {
    try {
      execFileSync(py, ["-c", `import ${mod}`], {
        stdio: ["ignore", "pipe", "ignore"],
        windowsHide: true,
        timeout: HEADROOM_PIP_TIMEOUT_MS,
        env: { ...process.env, PATH: EXTENDED_PATH },
      });
      return true;
    } catch {
      return false;
    }
  };
  const installed = check("headroom_ai") || check("headroom");
  if (!installed) return emptyExtrasStatus();
  const extras = {};
  for (const extra of HEADROOM_COMPRESSION_EXTRAS) {
    extras[extra] = EXTRA_MARKERS[extra].some((m) => check(m.replace(/-/g, "_")));
  }
  return { installed: true, version: null, extras };
}
