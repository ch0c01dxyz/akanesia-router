// GET /api/probe/online/[runId] — proxy polling run BazaarLink server-side.
//
// Hasil verifikasi kontrak (2026-09-30): polling BazaarLink bersifat PUBLIK
// tanpa autentikasi — siapa pun yang tahu runId bisa melakukan polling.
// Karena itu route ini mewajibkan pollToken milik sesi sendiri (disimpan
// saat start-run, dikembalikan ke klien lewat route start). Tanpa token
// yang cocok, akses ditolak 403.
//
// bazaarApiKey diambil dari memori (disimpan saat start-run), TIDAK PERNAH
// diteruskan ke browser. Sebelum ke frontend, field sensitif di-strip rekursif
// (startedByIp, userKey, headers, *apiKey/*token/*secret) tanpa merusak
// struktur hasil. Label probe statis yang masih Mandarin diterjemahkan ke
// Inggris via open-sse/config/probe-labels-en.js (lang:"en" tidak mempan
// untuk label — terverifikasi dari 2 run aktual). Entri memori dihapus
// begitu run mencapai status terminal.

import { NextResponse } from "next/server";
import { PROBE } from "open-sse/config/probe.js";
import { terjemahkanProbeKeInggris } from "open-sse/config/probe-labels-en.js";

export const dynamic = "force-dynamic";

// URL BazaarLink terpusat di open-sse/config/probe.js (single source of truth).
const BAZAAR_BASE_URL = PROBE.online.bazaarBaseUrl;
const FETCH_TIMEOUT_MS = 30_000;
// Run BazaarLink kedaluwarsa 30 menit (dokumen resmi); beri margin 5 menit.
const ONLINE_RUN_TTL_MS = 35 * 60 * 1000;
const STATUS_TERMINAL = new Set(["completed", "failed", "aborted"]);

// Nama field yang di-strip (perbandingan case-insensitive, tanpa -/_).
// Catatan: penghitung token (totalInputTokens, inputTokens, usage, ...)
// SENGAJA tidak di-strip — UI membutuhkannya sebagai bukti biaya.
const NAMA_SENSITIF = new Set([
  "startedbyip",
  "userkey",
  "headers",
  "apikey",
  "secret",
  "clientsecret",
  "accesstoken",
  "refreshtoken",
  "idtoken",
  "authtoken",
  "token",
  "authorization",
  "password",
  "bearer",
  "credential",
  "credentials",
]);

function kunciSensitif(nama) {
  const k = String(nama).toLowerCase().replace(/[-_]/g, "");
  if (NAMA_SENSITIF.has(k)) return true;
  // Tangkap varian seperti xApiKey / api-key-upstream / client_secret.
  if (k.includes("apikey") || k.includes("secret")) return true;
  return false;
}

// Strip rekursif: objek/array dibangun ulang tanpa key sensitif;
// struktur dan nilai lain dipertahankan.
function buangSensitif(nilai) {
  if (Array.isArray(nilai)) return nilai.map(buangSensitif);
  if (nilai && typeof nilai === "object") {
    const bersih = {};
    for (const [k, v] of Object.entries(nilai)) {
      if (kunciSensitif(k)) continue;
      bersih[k] = buangSensitif(v);
    }
    return bersih;
  }
  return nilai;
}

// Samarkan pola secret yang mungkin lolos ke pesan error (fail-closed).
function pesanAman(err) {
  const msg = String(err?.message || err || "kesalahan tidak dikenal").slice(0, 300);
  return msg
    .replace(/sk-[A-Za-z0-9_-]{8,}/g, "<redacted>")
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer <redacted>")
    .replace(/(api[_-]?key\s*[:=]\s*)\S+/gi, "$1<redacted>");
}

function onlineRunStore() {
  if (!globalThis.__probeOnlineRuns) globalThis.__probeOnlineRuns = new Map();
  return globalThis.__probeOnlineRuns;
}

function sapuKedaluwarsa(store) {
  const now = Date.now();
  for (const [k, v] of store) {
    if (now - (v?.createdAt || 0) > ONLINE_RUN_TTL_MS) store.delete(k);
  }
}

function expiredResponse() {
  return NextResponse.json({ error: "Hasil kedaluwarsa, jalankan ulang", code: "expired" }, { status: 404 });
}

function forbiddenResponse() {
  return NextResponse.json({ error: "Akses ditolak", code: "forbidden" }, { status: 403 });
}

// Teruskan 429 BazaarLink apa adanya: tanpa auto-retry, UI yang countdown.
async function teruskanRateLimit(res) {
  let retryAfterSeconds = null;
  try {
    const j = await res.json();
    if (Number.isFinite(Number(j?.retryAfterSeconds))) retryAfterSeconds = Number(j.retryAfterSeconds);
  } catch {
    // abaikan — coba header
  }
  if (retryAfterSeconds == null) {
    const h = res.headers.get("retry-after");
    if (h && Number.isFinite(Number(h))) retryAfterSeconds = Number(h);
  }
  return NextResponse.json(
    {
      error: `Rate limit tercapai${retryAfterSeconds != null ? `, coba lagi setelah ${retryAfterSeconds} detik` : ""}`,
      code: "rate_limited",
      retryAfterSeconds,
    },
    { status: 429 }
  );
}

export async function GET(request, { params }) {
  const { runId } = await params;

  const store = onlineRunStore();
  sapuKedaluwarsa(store);
  const entri = runId ? store.get(runId) : null;
  if (!entri) return expiredResponse();

  // Ownership check: polling BazaarLink publik tanpa auth, jadi token sesi
  // sendiri wajib cocok. Token dikirim via query ?token= atau header
  // x-poll-token. runId tidak dikenal tetap 404 (urutan cek dipertahankan).
  const tokenParam = request.nextUrl.searchParams.get("token");
  const tokenHeader = request.headers.get("x-poll-token");
  const pollToken = tokenParam || tokenHeader || "";
  if (!pollToken || pollToken !== entri.pollToken) return forbiddenResponse();

  // Hasil verifikasi kontrak: polling TIDAK butuh autentikasi BazaarLink.
  // Header Authorization hanya dikirim bila key tersedia (mode admin/bypass
  // rate limit); tanpa key, jangan kirim "Bearer null".
  const headers = {};
  if (entri.bazaarApiKey && String(entri.bazaarApiKey).trim()) {
    headers.Authorization = `Bearer ${entri.bazaarApiKey}`;
  }

  let res;
  try {
    res = await fetch(`${BAZAAR_BASE_URL}${PROBE.online.runPath(runId)}`, {
      headers,
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
  } catch (e) {
    return NextResponse.json({ error: `Polling gagal: ${pesanAman(e)}`, code: "poll_failed" }, { status: 502 });
  }

  if (res.status === 429) return teruskanRateLimit(res);
  if (res.status === 404) {
    // Run tidak dikenal di sisi BazaarLink — anggap kedaluwarsa.
    store.delete(runId);
    return expiredResponse();
  }
  if (!res.ok) {
    const peta = { 400: "invalid_request", 403: "forbidden", 502: "bad_gateway", 503: "unavailable" };
    const code = peta[res.status] || "poll_failed";
    const status = res.status === 400 || res.status === 403 ? res.status : 502;
    const teks = await res.text().catch(() => "");
    return NextResponse.json(
      { error: `BazaarLink: ${pesanAman(teks.slice(0, 200)) || `HTTP ${res.status}`}`, code },
      { status }
    );
  }

  let run;
  try {
    run = await res.json();
  } catch {
    return NextResponse.json({ error: "Polling gagal: respons BazaarLink tidak valid", code: "invalid_response" }, { status: 502 });
  }

  const bersih = buangSensitif(run);

  // Label probe statis dari BazaarLink tetap Mandarin Tradisional meski
  // start-run mengirim lang:"en" (terverifikasi dari 2 run aktual) —
  // terjemahkan manual di sini agar UI selalu Inggris.
  const hasil = terjemahkanProbeKeInggris(bersih);

  // Key tidak disimpan lebih lama dari perlu: hapus saat run terminal.
  if (STATUS_TERMINAL.has(run?.status)) {
    store.delete(runId);
  }

  // Log minimal — tanpa key dalam bentuk apapun (syarat wajib RULES.md).
  console.log("[Probe] online poll", { runId, status: run?.status });

  return NextResponse.json(hasil);
}
