// Check if running in Node.js environment (has fs module)
const isNode = typeof process !== "undefined" && process.versions?.node && typeof window === "undefined";

// Check if logging is enabled via environment variable (default: false)
const LOGGING_ENABLED = typeof process !== "undefined" && process.env?.ENABLE_REQUEST_LOGS === 'true';

let fs = null;
let path = null;
let LOGS_DIR = null;

// Lazy load Node.js modules (avoid top-level await)
async function ensureNodeModules() {
  if (!isNode || !LOGGING_ENABLED || fs) return;
  try {
    fs = await import("fs");
    path = await import("path");
    LOGS_DIR = path.join(typeof process !== "undefined" && process.cwd ? process.cwd() : ".", "logs");
  } catch {
    // Running in non-Node environment (Worker, Browser, etc.)
  }
}

// ---------------------------------------------------------------------------
// Buffered async chunk writer — pengganti fs.appendFileSync per chunk.
//
// Masalah lama: tiap chunk SSE memanggil fs.appendFileSync (buka+tulis+tutup
// file), terukur ~17 µs dan memblokir event loop; di hot loop streaming bisa
// 3x per token-chunk. Writer ini menampung chunk di antrean memori lalu
// menulis via satu fs.WriteStream per file (async, non-blocking).
//
// Flush dipicu bila salah satu terpenuhi:
//   - antrean >= 64 KB, atau
//   - antrean >= 100 potong, atau
//   - 1 detik sejak tulis terakhir tanpa flush (timer di-unref).
// Stream yang menganggur > 60 detik ditutup otomatis agar file descriptor
// tidak menumpuk pada server long-running.
//
// Fail-open: semua jalur dibungkus try/catch — logging TIDAK PERNAH melempar
// error ke hot path streaming; bila stream rusak, sisa log di-drop diam-diam.
// ---------------------------------------------------------------------------
const CHUNK_FLUSH_BYTES = 64 * 1024;
const CHUNK_FLUSH_COUNT = 100;
const CHUNK_FLUSH_INTERVAL_MS = 1000;
// Tutup stream yang tidak menerima chunk selama ini (hindari kebocoran fd).
const CHUNK_IDLE_CLOSE_MS = 60 * 1000;

// Writer yang masih hidup — dipakai untuk flush saat proses exit.
const penulisChunkAktif = new Set();
let penanganExitTerpasang = false;

function flushSemuaPenulisChunk() {
  for (const w of Array.from(penulisChunkAktif)) {
    try { w.flushAkhir(); } catch { /* abaikan */ }
  }
}

function flushSemuaPenulisChunkSinkron() {
  for (const w of Array.from(penulisChunkAktif)) {
    try { w.flushSinkronDarurat(); } catch { /* abaikan */ }
  }
}

// Daftarkan sekali saja, dan hanya saat writer pertama dibuat (lazy) —
// tidak ada efek samping saat modul di-import (penting untuk konteks Next.js).
function pasangPenanganExitSekali() {
  if (penanganExitTerpasang) return;
  penanganExitTerpasang = true;
  if (!isNode || typeof process === "undefined" || typeof process.on !== "function") return;
  try {
    // beforeExit boleh async: event loop ditahan sampai flush selesai.
    process.on("beforeExit", flushSemuaPenulisChunk);
    for (const sinyal of ["SIGINT", "SIGTERM"]) {
      const penangan = () => {
        // Best-effort sinkron untuk sinyal: tulis sisa antrean sekaligus,
        // lalu kembalikan perilaku default agar shutdown tetap normal.
        flushSemuaPenulisChunkSinkron();
        try { process.removeListener(sinyal, penangan); } catch { /* abaikan */ }
        try { process.kill(process.pid, sinyal); } catch { /* abaikan */ }
      };
      process.on(sinyal, penangan);
    }
  } catch { /* fail-open */ }
}

class BufferedChunkWriter {
  constructor(filePath) {
    this.filePath = filePath;
    this.antrean = [];
    this.byteAntrean = 0;
    this.stream = null;
    this.rusak = false;
    this.ditutup = false; // true permanen hanya via jalur exit
    this.menulis = false;
    this.timer = null;
    this.terakhirTulis = Date.now();
    penulisChunkAktif.add(this);
    pasangPenanganExitSekali();
  }

  // Dipanggil dari hot loop streaming — tidak boleh throw, tidak boleh blokir.
  tambah(chunk) {
    if (this.rusak || this.ditutup) return;
    try {
      const s = typeof chunk === "string" ? chunk : String(chunk ?? "");
      if (!s) return;
      penulisChunkAktif.add(this);
      this.antrean.push(s);
      this.byteAntrean += s.length;
      this.terakhirTulis = Date.now();
      if (this.byteAntrean >= CHUNK_FLUSH_BYTES || this.antrean.length >= CHUNK_FLUSH_COUNT) {
        this.flushSegera();
      } else {
        this.pastikanTimer();
      }
    } catch { /* fail-open: jangan ganggu streaming */ }
  }

  pastikanStream() {
    if (this.stream || this.rusak || this.ditutup) return this.stream;
    try {
      const st = fs.createWriteStream(this.filePath, { flags: "a", encoding: "utf8" });
      st.on("error", () => this.tandaiRusak());
      this.stream = st;
    } catch {
      this.tandaiRusak();
    }
    return this.stream;
  }

  pastikanTimer() {
    if (this.timer || this.rusak || this.ditutup) return;
    try {
      this.timer = setTimeout(() => {
        this.timer = null;
        if (this.ditutup || this.rusak) return;
        if (this.antrean.length > 0) {
          this.flush();
          this.pastikanTimer();
        } else if (this.stream && Date.now() - this.terakhirTulis > CHUNK_IDLE_CLOSE_MS) {
          // Tidak ada data 60 detik: tutup stream, buka lagi secara lazy bila ada chunk baru.
          this.tutupIdle();
        } else if (this.stream) {
          this.pastikanTimer();
        }
        // Tanpa stream & tanpa antrean: timer berhenti; tambah() akan mempersenjatai lagi.
      }, CHUNK_FLUSH_INTERVAL_MS);
      if (this.timer && typeof this.timer.unref === "function") this.timer.unref();
    } catch { /* abaikan */ }
  }

  hapusTimer() {
    try {
      if (this.timer) clearTimeout(this.timer);
    } catch { /* abaikan */ }
    this.timer = null;
  }

  // Jadwalkan flush di luar hot path (hindari tulis di dalam loop streaming).
  flushSegera() {
    try {
      setImmediate(() => this.flush());
    } catch {
      this.flush();
    }
  }

  flush() {
    if (this.menulis || this.rusak || this.ditutup || this.antrean.length === 0) return;
    let stream = null;
    try {
      stream = this.pastikanStream();
    } catch { /* abaikan */ }
    if (!stream) return;
    const data = this.antrean.join("");
    this.antrean = [];
    this.byteAntrean = 0;
    this.menulis = true;
    try {
      stream.write(data, (err) => {
        this.menulis = false;
        if (err) {
          this.tandaiRusak();
          return;
        }
        if (this.antrean.length > 0) this.flushSegera();
      });
    } catch {
      this.menulis = false;
      this.tandaiRusak();
    }
  }

  // Flush terakhir saat proses exit (boleh async — beforeExit menahan loop).
  flushAkhir() {
    this.ditutup = true;
    this.hapusTimer();
    if (this.rusak) {
      penulisChunkAktif.delete(this);
      return;
    }
    try {
      const stream = this.pastikanStream();
      const data = this.antrean.join("");
      this.antrean = [];
      this.byteAntrean = 0;
      if (stream && data) {
        stream.end(data, () => {
          try { penulisChunkAktif.delete(this); } catch { /* abaikan */ }
        });
      } else {
        try { stream?.end(); } catch { /* abaikan */ }
        penulisChunkAktif.delete(this);
      }
    } catch {
      this.tandaiRusak();
    }
  }

  // Darurat sinkron untuk SIGINT/SIGTERM — best-effort, sekali jalan.
  // Catatan: data yang masih di buffer internal stream (bukan antrean) adalah
  // best-effort; ini log debug, bukan data transaksional.
  flushSinkronDarurat() {
    this.ditutup = true;
    this.hapusTimer();
    try {
      if (!this.rusak && this.antrean.length > 0) {
        fs.appendFileSync(this.filePath, this.antrean.join(""));
      }
    } catch { /* abaikan */ }
    this.antrean = [];
    this.byteAntrean = 0;
    try { this.stream?.destroy(); } catch { /* abaikan */ }
    this.stream = null;
    penulisChunkAktif.delete(this);
  }

  // Tutup stream menganggur; dibuka lagi secara lazy saat chunk baru tiba.
  tutupIdle() {
    this.hapusTimer();
    const s = this.stream;
    this.stream = null;
    try {
      if (s) s.end(() => { try { penulisChunkAktif.delete(this); } catch { /* abaikan */ } });
      else penulisChunkAktif.delete(this);
    } catch {
      try { penulisChunkAktif.delete(this); } catch { /* abaikan */ }
    }
  }

  tandaiRusak() {
    this.rusak = true;
    this.antrean = [];
    this.byteAntrean = 0;
    this.hapusTimer();
    try { this.stream?.destroy(); } catch { /* abaikan */ }
    this.stream = null;
    penulisChunkAktif.delete(this);
  }
}

// Format timestamp for folder name: 20251228_143045_123
function formatTimestamp(date = new Date()) {
  const pad = (n) => String(n).padStart(2, "0");
  const y = date.getFullYear();
  const m = pad(date.getMonth() + 1);
  const d = pad(date.getDate());
  const h = pad(date.getHours());
  const min = pad(date.getMinutes());
  const s = pad(date.getSeconds());
  const ms = String(date.getMilliseconds()).padStart(3, "0");
  return `${y}${m}${d}_${h}${min}${s}_${ms}`;
}

// ---------------------------------------------------------------------------
// Retensi otomatis folder logs/.
//
// Setiap request (bila ENABLE_REQUEST_LOGS=true) membuat satu folder sesi,
// sehingga pemakaian intensif (mis. agent harness) bisa membengkakkan
// logs/ hingga puluhan GB. Env REQUEST_LOG_MAX_BYTES membatasi total ukuran
// (default 10 MB; 0 = tanpa batas). Saat sesi baru dibuat, bila total
// melebihi batas, sesi/file terlama dihapus lebih dulu (fail-open,
// fire-and-forget agar tidak menghambat request).
// ---------------------------------------------------------------------------
function requestLogMaxBytes() {
  const raw = typeof process !== "undefined" ? process.env?.REQUEST_LOG_MAX_BYTES : undefined;
  if (raw === undefined || raw === null || raw === "") return 10 * 1024 * 1024;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return 10 * 1024 * 1024;
  return Math.floor(n);
}

const RETENTION_CHECK_INTERVAL_MS = 60 * 1000;
let lastRetentionCheck = 0;

async function enforceLogRetention() {
  try {
    const now = Date.now();
    if (now - lastRetentionCheck < RETENTION_CHECK_INTERVAL_MS) return;
    lastRetentionCheck = now;

    const maxBytes = requestLogMaxBytes();
    if (!fs || !LOGS_DIR || maxBytes <= 0) return;
    if (!fs.existsSync(LOGS_DIR)) return;

    const candidates = [];
    let total = 0;
    for (const name of fs.readdirSync(LOGS_DIR)) {
      const p = path.join(LOGS_DIR, name);
      let st;
      try { st = fs.statSync(p); } catch { continue; }
      let size = 0;
      if (st.isDirectory()) {
        // Folder sesi berisi file datar (JSON + chunk) — cukup 1 level.
        try {
          for (const f of fs.readdirSync(p)) {
            try { size += fs.statSync(path.join(p, f)).size; } catch { /* abaikan */ }
          }
        } catch { /* abaikan */ }
      } else if (st.isFile()) {
        size = st.size;
      } else {
        continue;
      }
      total += size;
      candidates.push({ path: p, mtimeMs: st.mtimeMs, size });
    }
    if (total <= maxBytes) return;

    candidates.sort((a, b) => a.mtimeMs - b.mtimeMs);
    for (const c of candidates) {
      if (total <= maxBytes) break;
      try {
        fs.rmSync(c.path, { recursive: true, force: true });
        total -= c.size;
      } catch { /* abaikan */ }
    }
  } catch { /* abaikan: retensi tidak boleh mengganggu request */ }
}

// Internals untuk test. Bukan bagian API publik.
export const __test__ = {
  enforceLogRetention,
  requestLogMaxBytes,
  resetRetentionThrottle: () => { lastRetentionCheck = 0; },
};

// Create log session folder: {sourceFormat}_{targetFormat}_{model}_{timestamp}
async function createLogSession(sourceFormat, targetFormat, model) {
  await ensureNodeModules();
  if (!fs || !LOGS_DIR) return null;
  
  try {
    if (!fs.existsSync(LOGS_DIR)) {
      fs.mkdirSync(LOGS_DIR, { recursive: true });
    }
    
    const timestamp = formatTimestamp();
    const safeModel = (model || "unknown").replace(/[/:]/g, "-");
    const folderName = `${sourceFormat}_${targetFormat}_${safeModel}_${timestamp}`;
    const sessionPath = path.join(LOGS_DIR, folderName);
    
    fs.mkdirSync(sessionPath, { recursive: true });

    // Retensi otomatis: jaga total ukuran logs/ tetap di bawah batas
    // (fire-and-forget — kegagalan tidak mengganggu request).
    enforceLogRetention().catch(() => {});

    return sessionPath;
  } catch (err) {
    console.log("[LOG] Failed to create log session:", err.message);
    return null;
  }
}

// Write JSON file
function writeJsonFile(sessionPath, filename, data) {
  if (!fs || !sessionPath) return;
  
  try {
    const filePath = path.join(sessionPath, filename);
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
  } catch (err) {
    console.log(`[LOG] Failed to write ${filename}:`, err.message);
  }
}

// Mask sensitive data in headers (DISABLED - keep full token for testing)
function maskSensitiveHeaders(headers) {
  if (!headers) return {};
  return { ...headers };
  
  // Old masking code (disabled):
  // const masked = { ...headers };
  // const sensitiveKeys = ["authorization", "x-api-key", "cookie", "token"];
  // 
  // for (const key of Object.keys(masked)) {
  //   const lowerKey = key.toLowerCase();
  //   if (sensitiveKeys.some(sk => lowerKey.includes(sk))) {
  //     const value = masked[key];
  //     if (value && value.length > 20) {
  //       masked[key] = value.slice(0, 10) + "..." + value.slice(-5);
  //     }
  //   }
  // }
  // return masked;
}

// No-op logger when logging is disabled
function createNoOpLogger() {
  return {
    sessionPath: null,
    logClientRawRequest() {},
    logRawRequest() {},
    logOpenAIRequest() {},
    logTargetRequest() {},
    logProviderResponse() {},
    appendProviderChunk() {},
    appendOpenAIChunk() {},
    logConvertedResponse() {},
    appendConvertedChunk() {},
    logError() {}
  };
}

// Buat writer buffered untuk satu file chunk — lazy: stream dibuka saat
// chunk pertama tiba, jadi sesi non-streaming tidak membuka file sama sekali.
function buatPenulisChunk(sessionPath, namaFile) {
  if (!fs || !sessionPath) return null;
  try {
    return new BufferedChunkWriter(path.join(sessionPath, namaFile));
  } catch {
    return null;
  }
}

/**
 * Create a new log session and return logger functions
 * @param {string} sourceFormat - Source format from client (claude, openai, etc.)
 * @param {string} targetFormat - Target format to provider (antigravity, gemini-cli, etc.)
 * @param {string} model - Model name
 * @returns {Promise<object>} Promise that resolves to logger object with methods to log each stage
 */
export async function createRequestLogger(sourceFormat, targetFormat, model) {
  // Return no-op logger if logging is disabled
  if (!LOGGING_ENABLED) {
    return createNoOpLogger();
  }
  
  // Wait for session to be created before returning logger
  const sessionPath = await createLogSession(sourceFormat, targetFormat, model);
  
  // Writer buffered per file chunk (dibuat lazy saat chunk pertama).
  let penulisProvider = null;
  let penulisOpenAI = null;
  let penulisKlien = null;
  
  return {
    get sessionPath() { return sessionPath; },
    
    // 1. Log client raw request (before any conversion)
    logClientRawRequest(endpoint, body, headers = {}) {
      writeJsonFile(sessionPath, "1_req_client.json", {
        timestamp: new Date().toISOString(),
        endpoint,
        headers: maskSensitiveHeaders(headers),
        body
      });
    },
    
    // 2. Log raw request from client (after initial conversion like responsesApi)
    logRawRequest(body, headers = {}) {
      writeJsonFile(sessionPath, "2_req_source.json", {
        timestamp: new Date().toISOString(),
        headers: maskSensitiveHeaders(headers),
        body
      });
    },
    
    // 3. Log OpenAI intermediate format (source → openai)
    logOpenAIRequest(body) {
      writeJsonFile(sessionPath, "3_req_openai.json", {
        timestamp: new Date().toISOString(),
        body
      });
    },
    
    // 4. Log target format request (openai → target)
    logTargetRequest(url, headers, body) {
      writeJsonFile(sessionPath, "4_req_target.json", {
        timestamp: new Date().toISOString(),
        url,
        headers: maskSensitiveHeaders(headers),
        body
      });
    },
    
    // 5. Log provider response (for non-streaming or error)
    logProviderResponse(status, statusText, headers, body) {
      const filename = "5_res_provider.json";
      writeJsonFile(sessionPath, filename, {
        timestamp: new Date().toISOString(),
        status,
        statusText,
        headers: headers ? (typeof headers.entries === "function" ? Object.fromEntries(headers.entries()) : headers) : {},
        body
      });
    },
    
    // 5. Append streaming chunk ke respons provider (hot path — buffered, non-blocking)
    appendProviderChunk(chunk) {
      try {
        if (!penulisProvider) penulisProvider = buatPenulisChunk(sessionPath, "5_res_provider.txt");
        penulisProvider?.tambah(chunk);
      } catch {
        // Fail-open: logging tidak boleh mengganggu streaming
      }
    },
    
    // 6. Append chunk OpenAI intermediate (target → openai, hot path — buffered)
    appendOpenAIChunk(chunk) {
      try {
        if (!penulisOpenAI) penulisOpenAI = buatPenulisChunk(sessionPath, "6_res_openai.txt");
        penulisOpenAI?.tambah(chunk);
      } catch {
        // Fail-open: logging tidak boleh mengganggu streaming
      }
    },
    
    // 7. Log converted response to client (for non-streaming)
    logConvertedResponse(body) {
      writeJsonFile(sessionPath, "7_res_client.json", {
        timestamp: new Date().toISOString(),
        body
      });
    },
    
    // 7. Append streaming chunk ke respons klien (hot path — buffered, non-blocking)
    appendConvertedChunk(chunk) {
      try {
        if (!penulisKlien) penulisKlien = buatPenulisChunk(sessionPath, "7_res_client.txt");
        penulisKlien?.tambah(chunk);
      } catch {
        // Fail-open: logging tidak boleh mengganggu streaming
      }
    },
    
    // 6. Log error
    logError(error, requestBody = null) {
      writeJsonFile(sessionPath, "6_error.json", {
        timestamp: new Date().toISOString(),
        error: error?.message || String(error),
        stack: error?.stack,
        requestBody
      });
    }
  };
}

// Legacy functions for backward compatibility
export function logRequest() {}
export function logResponse() {}
export function logError(provider, { error, url, model, requestBody }) {
  if (!fs || !LOGS_DIR) return;
  
  try {
    if (!fs.existsSync(LOGS_DIR)) {
      fs.mkdirSync(LOGS_DIR, { recursive: true });
    }
    
    const date = new Date().toISOString().split("T")[0];
    const logPath = path.join(LOGS_DIR, `${provider}-${date}.log`);
    
    const logEntry = {
      timestamp: new Date().toISOString(),
      type: "error",
      provider,
      model,
      url,
      error: error?.message || String(error),
      stack: error?.stack,
      requestBody
    };
    
    fs.appendFileSync(logPath, JSON.stringify(logEntry) + "\n");
  } catch (err) {
    console.log("[LOG] Failed to write error log:", err.message);
  }
}
