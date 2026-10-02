import { Readable } from "stream";
import { MEMORY_CONFIG } from "../config/runtimeConfig.js";
import { dbg } from "./debugLog.js";

const originalFetch = globalThis.fetch;
const proxyDispatchers = new Map();

// ─── TLS fingerprinting via got-scraping (browser-like JA3) ───────────────
// Disabled: not in use. Kept commented for future re-enable.
// Restore the original block to re-enable per-host JA3 spoofing.
/*
let _gotScraping = null;
let _gotScrapingChecked = false;
const _gotScrapingLoggedHosts = new Set();

async function getGotScraping() {
  if (_gotScrapingChecked) return _gotScraping;
  _gotScrapingChecked = true;
  try {
    const mod = await import("got-scraping");
    _gotScraping = typeof mod.gotScraping === "function" ? mod.gotScraping : null;
    if (_gotScraping) dbg("TLS", "got-scraping loaded (browser-like JA3 enabled)");
  } catch (e) {
    console.warn(`[ProxyFetch] got-scraping unavailable, falling back to native fetch: ${e.message}`);
    _gotScraping = null;
  }
  return _gotScraping;
}

async function gotScrapingFetch(url, options) {
  const gs = await getGotScraping();
  if (!gs) return null;

  const method = (options.method || "GET").toUpperCase();
  const headersInit = options.headers || {};
  const headers = headersInit instanceof Headers
    ? Object.fromEntries(headersInit.entries())
    : { ...headersInit };

  return new Promise((resolve, reject) => {
    let settled = false;
    const stream = gs.stream({
      url,
      method,
      headers,
      body: method === "GET" || method === "HEAD" ? undefined : options.body,
      throwHttpErrors: false,
      retry: { limit: 0 },
      timeout: { request: undefined },
      followRedirect: false,
      decompress: true,
    });

    if (options.signal) {
      const onAbort = () => { try { stream.destroy(new Error("aborted")); } catch { } };
      if (options.signal.aborted) onAbort();
      else options.signal.addEventListener("abort", onAbort, { once: true });
    }

    stream.once("response", (res) => {
      if (settled) return;
      settled = true;
      const resHeaders = new Headers();
      for (const [k, v] of Object.entries(res.headers || {})) {
        if (Array.isArray(v)) v.forEach((x) => resHeaders.append(k, String(x)));
        else if (v != null) resHeaders.set(k, String(v));
      }
      const body = Readable.toWeb(stream);
      resolve(new Response(body, { status: res.statusCode, statusText: res.statusMessage || "", headers: resHeaders }));
    });

    stream.once("error", (err) => {
      if (settled) return;
      settled = true;
      reject(err);
    });
  });
}

async function tryGotScrapingFetch(url, options) {
  try {
    const res = await gotScrapingFetch(url, options);
    if (res) {
      try {
        const host = new URL(typeof url === "string" ? url : url.toString()).hostname;
        if (!_gotScrapingLoggedHosts.has(host)) {
          _gotScrapingLoggedHosts.add(host);
          dbg("TLS", `using got-scraping for ${host}`);
        }
      } catch { }
    }
    return res;
  } catch (e) {
    console.warn(`[ProxyFetch] got-scraping request failed, fallback to native fetch: ${e.message}`);
    return null;
  }
}
*/

// DNS cache — use Map to avoid prototype pollution via malformed hostnames
const DNS_CACHE = new Map();
const TLS_CERT_ERRORS = new Set([
  "SELF_SIGNED_CERT_IN_CHAIN",
  "DEPTH_ZERO_SELF_SIGNED_CERT",
  "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
  "UNABLE_TO_GET_ISSUER_CERT",
  "UNABLE_TO_GET_ISSUER_CERT_LOCALLY",
  "CERT_HAS_EXPIRED",
  "ERR_TLS_CERT_ALTNAME_INVALID",
]);

function isTlsCertError(err) {
  const code = err?.cause?.code || err?.code;
  return TLS_CERT_ERRORS.has(code);
}
const MITM_BYPASS_HOSTS = [
  "cloudcode-pa.googleapis.com",
  "daily-cloudcode-pa.googleapis.com",
  "api.individual.githubcopilot.com",
  "q.us-east-1.amazonaws.com",
  "codewhisperer.us-east-1.amazonaws.com",
  "api2.cursor.sh",
];
const GOOGLE_DNS_SERVERS = ["8.8.8.8", "8.8.4.4"];
const HTTPS_PORT = 443;
const HTTP_SUCCESS_MIN = 200;
const HTTP_SUCCESS_MAX = 300;

function normalizeString(value) {
  if (value === undefined || value === null) return "";
  return String(value).trim();
}

/**
 * Simpan entri DNS dengan eviksi LRU sederhana.
 * Map menjaga urutan insert: entri yang baru dipakai/ditulis dipindah ke
 * posisi paling baru, dan bila penuh, entri tertua dibuang. Ini menjaga
 * DNS_CACHE tidak tumbuh tanpa batas pada server long-running.
 */
function simpanDnsCache(hostname, entry) {
  DNS_CACHE.delete(hostname);
  DNS_CACHE.set(hostname, entry);
  while (DNS_CACHE.size > MEMORY_CONFIG.dnsCacheMaxSize) {
    DNS_CACHE.delete(DNS_CACHE.keys().next().value);
  }
}

/**
 * Resolve real IP using Google DNS (bypass system DNS)
 */
async function resolveRealIP(hostname) {
  const cached = DNS_CACHE.get(hostname);
  if (cached) {
    if (Date.now() < cached.expiry) {
      simpanDnsCache(hostname, cached); // refresh urutan LRU
      return cached.ip;
    }
    DNS_CACHE.delete(hostname); // kedaluwarsa — resolve ulang
  }

  try {
    const dns = await import("dns");
    const { promisify } = await import("util");
    const resolver = new dns.Resolver();
    resolver.setServers(GOOGLE_DNS_SERVERS);
    const resolve4 = promisify(resolver.resolve4.bind(resolver));
    const addresses = await resolve4(hostname);
    simpanDnsCache(hostname, { ip: addresses[0], expiry: Date.now() + MEMORY_CONFIG.dnsCacheTtlMs });
    return addresses[0];
  } catch (error) {
    console.warn(`[ProxyFetch] DNS resolve failed for ${hostname}:`, error.message);
    return null;
  }
}

/**
 * Check if request should bypass MITM DNS redirect
 */
function shouldBypassMitmDns(url) {
  try {
    const hostname = new URL(url).hostname;
    return MITM_BYPASS_HOSTS.some(host => hostname.includes(host));
  } catch { return false; }
}

function shouldBypassByNoProxy(targetUrl, noProxyValue) {
  const noProxy = normalizeString(noProxyValue);
  if (!noProxy) return false;

  let hostname;
  try { hostname = new URL(targetUrl).hostname.toLowerCase(); } catch { return false; }
  const patterns = noProxy.split(",").map((p) => p.trim().toLowerCase()).filter(Boolean);

  return patterns.some((pattern) => {
    if (pattern === "*") return true;
    if (pattern.startsWith(".")) return hostname.endsWith(pattern) || hostname === pattern.slice(1);
    return hostname === pattern || hostname.endsWith(`.${pattern}`);
  });
}

/**
 * Get proxy URL from environment
 */
function getEnvProxyUrl(targetUrl) {
  const noProxy = process.env.NO_PROXY || process.env.no_proxy;
  if (shouldBypassByNoProxy(targetUrl, noProxy)) return null;

  let protocol;
  try { protocol = new URL(targetUrl).protocol; } catch { return null; }

  if (protocol === "https:") {
    return process.env.HTTPS_PROXY || process.env.https_proxy ||
      process.env.ALL_PROXY || process.env.all_proxy;
  }

  return process.env.HTTP_PROXY || process.env.http_proxy ||
    process.env.ALL_PROXY || process.env.all_proxy;
}

/**
 * Normalize proxy URL (allow host:port)
 */
function normalizeProxyUrl(proxyUrl) {
  const normalizedInput = normalizeString(proxyUrl);
  if (!normalizedInput) return null;

  try {

    new URL(normalizedInput);
    return normalizedInput;
  } catch {
    // Allow "127.0.0.1:7890" style values
    return `http://${normalizedInput}`;
  }
}

function resolveConnectionProxyUrl(targetUrl, proxyOptions) {
  const enabled = proxyOptions?.enabled === true || proxyOptions?.connectionProxyEnabled === true;
  if (!enabled) return null;

  const proxyUrlRaw = normalizeString(proxyOptions?.url ?? proxyOptions?.connectionProxyUrl);
  if (!proxyUrlRaw) return null;

  const noProxy = normalizeString(proxyOptions?.noProxy ?? proxyOptions?.connectionNoProxy);
  if (noProxy && shouldBypassByNoProxy(targetUrl, noProxy)) return null;

  return normalizeProxyUrl(proxyUrlRaw);
}

/**
 * Create proxy dispatcher lazily (undici-compatible)
 */
async function getDispatcher(proxyUrl, insecure = false) {
  const normalized = normalizeProxyUrl(proxyUrl);
  if (!normalized && !insecure) return null;

  // Cache dibedakan per (proxy, insecure): dispatcher insecure memakai
  // rejectUnauthorized:false dan tidak boleh dipakai ulang untuk request aman.
  const key = `${normalized || "direct"}::${insecure ? "insecure" : "secure"}`;
  if (!proxyDispatchers.has(key)) {
    // Evict oldest entry if max size reached — tutup dispatcher yang
    // di-evict agar socket/timer undici dilepas (hindari kebocoran fd
    // pada server long-running). Kegagalan close tidak boleh mengganggu request.
    if (proxyDispatchers.size >= MEMORY_CONFIG.proxyDispatchersMaxSize) {
      const oldestKey = proxyDispatchers.keys().next().value;
      const oldest = proxyDispatchers.get(oldestKey);
      proxyDispatchers.delete(oldestKey);
      try {
        await oldest?.close?.();
      } catch { /* abaikan */ }
    }
    const { Agent, ProxyAgent } = await import("undici");
    const connect = insecure ? { rejectUnauthorized: false } : undefined;
    const dispatcher = normalized
      ? new ProxyAgent({ uri: normalized, ...(insecure ? { requestTls: connect } : {}) })
      : new Agent({ connect });
    proxyDispatchers.set(key, dispatcher);
  }

  return proxyDispatchers.get(key);
}

async function fetchWithTlsFallback(url, options, proxyUrl) {
  try {
    const dispatcher = proxyUrl ? await getDispatcher(proxyUrl) : undefined;
    return await originalFetch(url, dispatcher ? { ...options, dispatcher } : options);
  } catch (err) {
    const isStrictSsl = process.env.STRICT_SSL === "true" || process.env.STRICT_SSL === "1";
    if (!isStrictSsl && isTlsCertError(err)) {
      // Body stream yang sudah terkunci tidak bisa di-retry — lempar error asli.
      if (options.body && typeof options.body.getReader === "function" && options.body.locked) {
        throw err;
      }
      // ponytail: fallback agent insecure in-memory untuk sertifikat MITM
      // korporat/antivirus yang self-signed
      console.warn(`[ProxyFetch] TLS cert verification failed (${err.cause?.code || err.code}), retrying with insecure TLS: ${url}`);
      const insecureDispatcher = await getDispatcher(proxyUrl, true);
      return await originalFetch(url, { ...options, dispatcher: insecureDispatcher });
    }
    throw err;
  }
}

// ─── MITM-bypass connection pooling ─────────────────────────────────────
// Temuan #6: implementasi lama membuka socket + TLS handshake BARU per
// request (mahal: DNS + TCP + TLS setiap kali). Sekarang satu undici Agent
// di-cache dan dipakai ulang untuk semua origin bypass; logika DNS-bypass
// dipindah ke fungsi `lookup` kustom sehingga koneksi tetap di-pool.
//
// Keamanan dipertahankan: SNI (servername) dan validasi sertifikat tetap
// memakai hostname asli dari URL (perilaku default undici) — TIDAK ADA
// rejectUnauthorized: false. `lookup` hanya mengganti IP tujuan koneksi.
let bypassAgent = null;
let bypassAgentGagal = false;

/**
 * Custom DNS lookup untuk bypass MITM: resolve via Google DNS (bukan DNS
 * sistem), lalu kembalikan IP-nya ke socket. Dipakai sebagai
 * `connect.lookup` pada undici Agent.
 */
function bypassLookup(hostname, _options, callback) {
  resolveRealIP(hostname).then(
    (ip) => {
      if (!ip) {
        callback(new Error(`[ProxyFetch] DNS bypass gagal resolve ${hostname}`));
        return;
      }
      // undici/Node memanggil lookup dengan options.all=true → callback
      // harus menerima array [{ address, family }], bukan argumen tunggal.
      if (_options && _options.all) callback(null, [{ address: ip, family: 4 }]);
      else callback(null, ip, 4);
    },
    (err) => callback(err instanceof Error ? err : new Error(String(err)))
  );
}

async function getBypassAgent() {
  if (bypassAgent) return bypassAgent;
  if (bypassAgentGagal) throw new Error("[ProxyFetch] bypass agent gagal dibuat sebelumnya");
  try {
    const { Agent } = await import("undici");
    bypassAgent = new Agent({
      // lookup kustom → koneksi ke IP hasil Google DNS, tapi TLS tetap
      // memverifikasi sertifikat terhadap hostname asli (SNI otomatis).
      connect: { lookup: bypassLookup },
    });
    return bypassAgent;
  } catch (err) {
    bypassAgentGagal = true;
    throw err;
  }
}

/**
 * Implementasi lama (satu koneksi per request) — dipertahankan sebagai
 * fallback bila pembuatan pool gagal, agar tidak ada regresi konektivitas.
 */
async function createBypassRequestLegacy(parsedUrl, realIP, options) {
  const httpsModule = await import("https");
  const netModule = await import("net");
  // CJS modules expose exports via .default in ESM dynamic import context
  const https = httpsModule.default ?? httpsModule;
  const net = netModule.default ?? netModule;

  return new Promise((resolve, reject) => {
    const socket = new net.Socket();

    socket.connect(HTTPS_PORT, realIP, () => {
      const reqOptions = {
        socket,
        // SNI + cert hostname are validated against the hostname the caller
        // asked for, not the IP we connected to. This keeps the DNS-bypass
        // (avoiding /etc/hosts MITM) while still rejecting on-path attackers
        // that present a different cert. The MITM_BYPASS_HOSTS targets are
        // all public-CA-issued (Google / GitHub / AWS / Cursor) so default
        // verification works without any extra trust store.
        servername: parsedUrl.hostname,
        path: parsedUrl.pathname + parsedUrl.search,
        method: options.method || "POST",
        headers: {
          ...options.headers,
          Host: parsedUrl.hostname,
        },
      };

      const req = https.request(reqOptions, (res) => {
        const response = {
          ok: res.statusCode >= HTTP_SUCCESS_MIN && res.statusCode < HTTP_SUCCESS_MAX,
          status: res.statusCode,
          statusText: res.statusMessage,
          headers: new Map(Object.entries(res.headers)),
          body: Readable.toWeb(res),
          text: async () => {
            const chunks = [];
            for await (const chunk of res) chunks.push(chunk);
            return Buffer.concat(chunks).toString();
          },
          json: async () => JSON.parse(await response.text()),
        };
        resolve(response);
      });

      req.on("error", reject);
      if (options.body) {
        req.write(typeof options.body === "string" ? options.body : JSON.stringify(options.body));
      }
      req.end();
    });

    socket.on("error", reject);
  });
}

/**
 * HTTPS request via pooled undici Agent dengan DNS-bypass (perilaku dan
 * signature identik dengan implementasi lama dari sudut pandang pemanggil).
 */
async function createBypassRequest(parsedUrl, realIP, options) {
  let agent;
  try {
    agent = await getBypassAgent();
  } catch (err) {
    console.warn(`[ProxyFetch] Bypass pool gagal dibuat, fallback ke koneksi langsung: ${err.message}`);
    return createBypassRequestLegacy(parsedUrl, realIP, options);
  }

  // Hostname asli tetap di URL → SNI + validasi sertifikat tidak berubah.
  const targetUrl = `${parsedUrl.protocol}//${parsedUrl.hostname}${parsedUrl.port ? `:${parsedUrl.port}` : ""}${parsedUrl.pathname}${parsedUrl.search}`;
  const body = options.body == null
    ? undefined
    : (typeof options.body === "string" ? options.body : JSON.stringify(options.body));

  const res = await originalFetch(targetUrl, {
    method: options.method || "POST",
    headers: {
      ...options.headers,
      Host: parsedUrl.hostname,
    },
    body,
    signal: options.signal,
    // redirect manual: samakan perilaku lama (https.request tidak follow redirect)
    redirect: "manual",
    dispatcher: agent,
  });

  // Bentuk respons dipertahankan identik dengan implementasi lama.
  return {
    ok: res.ok,
    status: res.status,
    statusText: res.statusText,
    headers: new Map(res.headers.entries()),
    body: res.body,
    text: () => res.text(),
    json: () => res.json(),
  };
}

export async function proxyAwareFetch(url, options = {}, proxyOptions = null) {
  const targetUrl = typeof url === "string" ? url : url.toString();

  // Vercel relay: forward request via relay headers
  const vercelRelayUrl = normalizeString(proxyOptions?.vercelRelayUrl);
  if (vercelRelayUrl) {
    const parsed = new URL(targetUrl);
    const baseHeaders = options.headers instanceof Headers
      ? Object.fromEntries(options.headers.entries())
      : { ...(options.headers || {}) };
    const relayHeaders = {
      ...baseHeaders,
      "x-relay-target": `${parsed.protocol}//${parsed.host}`,
      "x-relay-path": `${parsed.pathname}${parsed.search}`,
    };
    return originalFetch(vercelRelayUrl, { ...options, headers: relayHeaders });
  }

  const connectionProxyUrl = resolveConnectionProxyUrl(targetUrl, proxyOptions);
  const envProxyUrl = connectionProxyUrl ? null : normalizeProxyUrl(getEnvProxyUrl(targetUrl));
  const proxyUrl = connectionProxyUrl || envProxyUrl;

  // Konfigurasi proxy rusak (pool tak valid / DB error) padahal proxy
  // dimaksudkan untuk koneksi ini: selalu catat ke Console Log, dan
  // fail-closed (500) bila tidak ada proxy yang bisa dipakai. Kalau
  // fallback legacy masih menyediakan proxy, request diteruskan lewat
  // sana tapi masalah pool tetap tercatat.
  const proxyConfigError = normalizeString(proxyOptions?.proxyConfigError);
  if (proxyConfigError) {
    console.error(`[ProxyFetch] ${proxyConfigError} | target=${targetUrl}`);
    if (!proxyUrl) {
      throw new Error(`[ProxyFetch] ${proxyConfigError}`);
    }
  }

  // noProxy adalah bagian dari konfigurasi proxy provider sendiri: host yang
  // dikecualikan memang dimaksudkan direct, jadi strict tidak boleh me-throw
  // untuknya. Strict hanya mengikat host yang wajib lewat proxy.
  const connNoProxy = normalizeString(proxyOptions?.noProxy ?? proxyOptions?.connectionNoProxy);
  const noProxyExempt = connNoProxy ? shouldBypassByNoProxy(targetUrl, connNoProxy) : false;

  // Mode strict berarti "jangan pernah keluar lewat IP langsung".
  // Gate pada proxy yang *dimaksudkan*: pemanggil seperti executor Qoder memakai
  // strictProxy dengan arti "jangan replay request ini secara langsung bila proxy
  // gagal" (signature COSY yang di-replay mengembalikan 403), bukan "proxy wajib
  // ada". Bila tidak ada yang dikonfigurasi, mereka harus tetap jalan.
  const proxyIntended = proxyOptions?.proxyPoolId
    || proxyOptions?.enabled === true
    || proxyOptions?.connectionProxyEnabled === true
    || !!normalizeString(proxyOptions?.url ?? proxyOptions?.connectionProxyUrl);
  const strictHold = proxyOptions?.strictProxy === true && proxyIntended;

  // MITM DNS bypass: for known MITM-intercepted hosts, resolve real IP to avoid DNS spoof
  if (shouldBypassMitmDns(targetUrl)) {
    if (proxyUrl) {
      // Proxy resolves DNS externally (not affected by /etc/hosts) — use proxy directly
      try {
        return await fetchWithTlsFallback(url, options, proxyUrl);
      } catch (proxyError) {
        if (proxyOptions?.strictProxy === true) {
          throw new Error(`[ProxyFetch] Proxy required but failed (strictProxy=true): ${proxyError.message}`);
        }
        console.warn(`[ProxyFetch] Proxy failed, falling back to direct bypass: ${proxyError.message}`);
      }
    }
    // No proxy — manually resolve real IP to bypass DNS spoof.
    // Ini koneksi langsung ke IP: di bawah strict hold harus ditolak, bukan
    // diam-diam mengekspos alamat asli (#4333). Pengecualian: host yang masuk
    // noProxy memang dimaksudkan direct oleh konfigurasi provider sendiri.
    if (strictHold && !noProxyExempt) {
      throw new Error("[ProxyFetch] Proxy required but none resolved (strictProxy=true)");
    }
    try {
      const parsedUrl = new URL(targetUrl);
      const realIP = await resolveRealIP(parsedUrl.hostname);
      if (realIP) return await createBypassRequest(parsedUrl, realIP, options);
    } catch (error) {
      console.warn(`[ProxyFetch] MITM bypass failed: ${error.message}`);
    }
  }

  if (proxyUrl) {
    try {
      return await fetchWithTlsFallback(url, options, proxyUrl);
    } catch (proxyError) {
      // If strictProxy is enabled, fail hard instead of falling back to direct
      if (proxyOptions?.strictProxy === true) {
        throw new Error(`[ProxyFetch] Proxy required but failed (strictProxy=true): ${proxyError.message}`);
      }
      console.warn(`[ProxyFetch] Proxy failed, falling back to direct: ${proxyError.message}`);
      return fetchWithTlsFallback(url, options, null);
    }
  }

  // Sampai di sini dengan proxy terkonfigurasi tapi tidak ter-resolve adalah
  // kasus strict — pool nonaktif atau kosong, atau semua proxy terhapus —
  // jadi tolak daripada diam-diam mengekspos alamat asli (#4333). Blok catch
  // di atas hanya mencakup proxy yang benar-benar sempat dicoba.
  // Host noProxy dikecualikan: direct memang dimaksudkan konfigurasinya.
  if (strictHold && !noProxyExempt) {
    throw new Error("[ProxyFetch] Proxy required but none resolved (strictProxy=true)");
  }

  // got-scraping disabled — use native fetch directly
  // (Re-enable per-host by wrapping with tryGotScrapingFetch when needed)
  return fetchWithTlsFallback(url, options, null);
}

/**
 * Patched global fetch with env-proxy support and MITM DNS bypass
 */
async function patchedFetch(url, options = {}) {
  return proxyAwareFetch(url, options, null);
}

// Idempotency guard — only patch once to avoid wrapping multiple times
if (globalThis.fetch !== patchedFetch) {
  globalThis.fetch = patchedFetch;
}

export default patchedFetch;
