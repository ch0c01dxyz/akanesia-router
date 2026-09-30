import fs from "fs";
import path from "path";
import {
  IS_WINDOWS,
  execFileOutputAsync,
  findOnPathAsync,
  isExecutablePath,
  probeRunAsync,
  windowsExecutableExtensions,
} from "../platform.js";

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

const IS_WIN = IS_WINDOWS;

// Semua fungsi deteksi di file ini async: probing binary memakai execFile
// (bukan execFileSync) supaya event loop Node tidak terblokir. Versi sync
// lama menahan SELURUH server selama deteksi berjalan — di Windows itu bisa
// belasan detik, sehingga user tidak bisa pindah halaman sampai status
// headroom selesai dimuat.

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
const EXTENDED_ENV = () => ({ ...process.env, PATH: EXTENDED_PATH });
const PYTHON_CANDIDATES = ["python3.13", "python3.12", "python3.11", "python3.10", "python3", "python"];
const MIN_VERSION = [3, 10];
const HEADROOM_HEALTH_TIMEOUT_MS = 1500;
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]", "0.0.0.0"]);

// Hasil deteksi environment (binary/python/extras) di-cache singkat: scan
// penuh melibatkan belasan spawn proses. `running` TIDAK di-cache — selalu
// di-probe fresh supaya status Start/Stop di UI akurat.
const ENV_CACHE_TTL_MS = 30000;
let envCache = null; // { at, env }

export function invalidateHeadroomStatusCache() {
  envCache = null;
}

export const DEFAULT_HEADROOM_URL = process.env.HEADROOM_URL || "http://localhost:8787";

// Detect whether the headroom CLI is installed and where its binary lives.
// The `where`/`which` hit is validated, not trusted blindly: it must be
// executable on the current platform (on Windows an extensionless script is
// NOT executable — spawning one pops the "Open with" dialog) and it must
// actually run (`--version` exits 0).
export async function findHeadroomBinary() {
  const bin = await findOnPathAsync("headroom", EXTENDED_PATH);
  return bin && (await probeRunAsync(bin, ["--version"])) ? bin : null;
}

// Find the `uv` binary (used for uv-managed headroom installs).
export async function findUvBinary() {
  const bin = await findOnPathAsync("uv", EXTENDED_PATH);
  return bin && (await probeRunAsync(bin, ["--version"])) ? bin : null;
}

// Python inside uv's isolated tool venv for headroom-ai
// (`uv tool install "headroom-ai[all]"`). Returns null when not present.
// existsSync cepat (tanpa spawn) jadi tetap sync.
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
export async function getHeadroomInstallKind() {
  if (findUvToolPython()) return "uv";
  const py = await findPython310();
  if (py) {
    const ok = await probeRunAsync(py, ["-m", "pip", "show", "headroom-ai"], HEADROOM_PIP_TIMEOUT_MS);
    if (ok) return "pip";
  }
  // Binary exists but package not visible to any probed python (e.g. pipx,
  // conda env not on PATH) — treat as pip-style for marker probing fallback.
  if (await findHeadroomBinary()) return "pip";
  return null;
}

// Interpreters to probe, most specific first: the python next to the headroom
// binary (guaranteed to have headroom-ai), then full paths from EXTRA_BINS, then
// bare names resolved via PATH.
//
// Windows note: bare names are resolved through `where` (PATHEXT-aware) and
// any still-bare candidate is expanded with PATHEXT extensions, so probing
// never hands an extensionless name to the OS — executing one via cmd.exe is
// what popped the Windows "Open with" dialog.
async function pythonCandidates() {
  const list = [];
  const add = (p) => {
    if (p && !list.includes(p)) list.push(p);
  };
  const bin = await findHeadroomBinary();
  if (bin) {
    const dir = path.dirname(bin);
    const names = IS_WIN ? ["python.exe", "python3.exe"] : ["python3", "python3.13", "python"];
    for (const n of names) add(path.join(dir, n));
  }
  for (const dir of EXTRA_BINS) {
    if (!dir) continue;
    for (const n of PYTHON_CANDIDATES) add(path.join(dir, IS_WIN ? `${n}.exe` : n));
  }
  if (IS_WIN) {
    for (const n of PYTHON_CANDIDATES) add(await findOnPathAsync(n, EXTENDED_PATH));
  } else {
    for (const n of PYTHON_CANDIDATES) add(n);
  }
  return IS_WIN ? list.flatMap(expandWindowsExecutable) : list;
}

// `python` → [`python.com`, `python.exe`, `python.bat`, `python.cmd`];
// already-suffixed names pass through untouched.
function expandWindowsExecutable(p) {
  if (!IS_WIN || !p || /\.[a-z0-9]+$/i.test(path.basename(p))) return [p];
  return windowsExecutableExtensions().map((ext) => `${p}${ext}`);
}

// `python --version` TANPA shell (execFile). Versi sync lama memakai
// execSync(string) yang berjalan via cmd.exe di Windows — cmd.exe mengeksekusi
// lewat asosiasi file, sehingga script tanpa ekstensi (mis. pyenv shim)
// memicu dialog "Open with". Mengembalikan string versi atau null.
async function probePythonVersion(candidate) {
  return execFileOutputAsync(candidate, ["--version"], HEADROOM_PIP_TIMEOUT_MS, EXTENDED_ENV());
}

// Find a Python interpreter >= 3.10 (headroom-ai requires it). Returns null if none.
// `python3`, `python3.13`, `python` can point at different envs on any OS. Prefer
// the interpreter that can also see the installed `headroom-ai` package so the
// dashboard probes and install action operate on the same interpreter as the CLI.
// Falls back to the first version-eligible candidate when headroom-ai is not yet
// installed anywhere (needed for the initial install).
//
// Kandidat di-probe paralel (Promise.all) — kegagalan cepat, dan event loop
// tetap bebas sehingga request lain tidak antre di belakang deteksi.
export async function findPython310() {
  const candidates = await pythonCandidates();
  const probed = await Promise.all(
    candidates.map(async (candidate) => {
      // Never hand a non-executable file to the OS. On Windows this guard is
      // what prevents the "Open with" dialog: an extensionless script is
      // rejected here instead of being executed via the shell.
      if (!isExecutablePath(candidate)) return null;
      const ver = await probePythonVersion(candidate);
      const match = ver && ver.match(/(\d+)\.(\d+)/);
      if (!match) return null;
      const [major, minor] = [parseInt(match[1], 10), parseInt(match[2], 10)];
      if (!(major > MIN_VERSION[0] || (major === MIN_VERSION[0] && minor >= MIN_VERSION[1]))) return null;
      return candidate;
    })
  );
  const eligible = probed.filter(Boolean);
  if (eligible.length === 0) return null;
  // Pilih interpreter yang bisa melihat headroom-ai (paralel, urutan prioritas dijaga).
  const seen = await Promise.all(
    eligible.map((py) =>
      probeRunAsync(py, ["-m", "pip", "show", "headroom-ai"], HEADROOM_PIP_TIMEOUT_MS).then((ok) =>
        ok ? py : null
      )
    )
  );
  return seen.find(Boolean) || eligible[0];
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

// Deteksi environment (binary, python, extras) — di-cache 30 detik.
async function detectHeadroomEnvironment() {
  const now = Date.now();
  if (envCache && now - envCache.at < ENV_CACHE_TTL_MS) return envCache.env;
  const [bin, python, uvPy] = await Promise.all([
    findHeadroomBinary(),
    findPython310(),
    Promise.resolve(findUvToolPython()),
  ]);
  const installed = Boolean(bin) || Boolean(uvPy);
  const extrasStatus = installed
    ? await getInstalledHeadroomExtras(python)
    : { installed: false, version: null, extras: { code: false, ml: false }, via: null };
  const env = {
    installed,
    path: bin,
    python: uvPy || python,
    version: extrasStatus.version,
    extras: extrasStatus.extras,
    via: extrasStatus.via || null,
  };
  envCache = { at: now, env };
  return env;
}

// Aggregate status for the dashboard: installed, running, python interpreter.
// `running` selalu fresh; sisanya dari cache environment 30 detik.
export async function getHeadroomStatus(url) {
  const [env, running] = await Promise.all([detectHeadroomEnvironment(), probeProxyRunning(url)]);
  const localUrl = isLoopbackHeadroomUrl(url);
  return {
    ...env,
    running,
    localUrl,
    canStart: env.installed && localUrl,
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
export async function getInstalledHeadroomExtras(python) {
  // 1) uv-managed install: probe the isolated tool venv directly.
  const uvPy = findUvToolPython();
  // 2) pip-managed install: probe the given/found system python.
  const py = python || (await findPython310());
  const [uvStatus, pipStatus] = await Promise.all([
    uvPy ? probeExtrasViaPython(uvPy) : Promise.resolve(null),
    py ? probeExtrasViaPython(py) : Promise.resolve(null),
  ]);
  if (uvStatus && uvStatus.installed) return { ...uvStatus, via: "uv" };
  if (pipStatus && pipStatus.installed) return { ...pipStatus, via: "pip" };
  return { installed: false, version: null, extras: { code: false, ml: false }, via: null };
}

function emptyExtrasStatus() {
  return { installed: false, version: null, extras: { code: false, ml: false } };
}

async function probeExtrasViaPython(py) {
  const out = await execFileOutputAsync(
    py,
    ["-m", "pip", "list", "--format=json", "--disable-pip-version-check"],
    HEADROOM_PIP_TIMEOUT_MS,
    EXTENDED_ENV()
  );
  if (out === null) {
    // pip may be missing in the venv — fall back to import probing.
    return probeExtrasViaImport(py);
  }
  try {
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
    return emptyExtrasStatus();
  }
}

// Fallback when `pip` is unavailable: check marker packages via import.
async function probeExtrasViaImport(py) {
  const check = (mod) =>
    execFileOutputAsync(py, ["-c", `import ${mod}`], HEADROOM_PIP_TIMEOUT_MS, EXTENDED_ENV()).then(
      (out) => out !== null
    );
  const [hasAi, hasLegacy] = await Promise.all([check("headroom_ai"), check("headroom")]);
  if (!hasAi && !hasLegacy) return emptyExtrasStatus();
  const extrasChecks = await Promise.all(
    HEADROOM_COMPRESSION_EXTRAS.map(async (extra) => {
      const found = await Promise.all(
        EXTRA_MARKERS[extra].map((m) => check(m.replace(/-/g, "_")))
      );
      return found.some(Boolean);
    })
  );
  const extras = {};
  HEADROOM_COMPRESSION_EXTRAS.forEach((extra, i) => {
    extras[extra] = extrasChecks[i];
  });
  return { installed: true, version: null, extras };
}
