// POST /api/probe/online — proxy start-run ke BazaarLink Probe API (ide 5c).
//
// Mengikuti kontrak resmi https://bazaarlink.ai/probe-api-skill.md:
// POST /api/probe/run dengan body { baseUrl, apiKey, modelId, claimedModel,
// upstreamFormat, sync: false, lang: "en" }, lalu polling dilakukan
// server-side via route [runId].
//
// TERVERIFIKASI (2026-09-29, via agent harness + browser MCP): endpoint Probe
// publik TIDAK mewajibkan autentikasi pemanggil — run diterima tanpa header
// Authorization. Rate limit 30 run/IP/jam dihitung per IP egress, bukan per
// key; Bearer <admin-api-key> hanya untuk bypass limit (mode admin terpisah).
// bazaarApiKey karenanya OPSIONAL: bila ada (client/env) tetap dikirim
// sebagai Authorization: Bearer, bila tidak ada header tidak dikirim sama
// sekali. Respons async HANYA berisi { runId } — tanpa status.
//
// Keamanan: klien hanya mengirim connectionId; API key upstream diambil
// server-side dari koneksi tersimpan dan diteruskan ke BazaarLink via HTTPS.
// bazaarApiKey (bila ada) hanya disimpan di memori selama run (maks 35 menit)
// — tidak ke DB/file/log. Prinsip redaksi meniru ide #7: nol secret di
// log/response.

import { NextResponse } from "next/server";
import { getProviderConnections } from "@/models";
import { getSettings } from "@/lib/db/repos/settingsRepo.js";
import { getProviderCredentials } from "@/sse/services/auth.js";
import { checkAndRefreshToken } from "@/sse/services/tokenRefresh.js";
import REGISTRY from "open-sse/providers/registry/index.js";
import { PROBE } from "open-sse/config/probe.js";
import {
  isOpenAICompatibleProvider,
  isAnthropicCompatibleProvider,
  isCustomEmbeddingProvider,
} from "@/shared/constants/providers.js";

export const dynamic = "force-dynamic";

// URL BazaarLink terpusat di open-sse/config/probe.js (single source of truth).
const BAZAAR_PROBE_RUN_URL = `${PROBE.online.bazaarBaseUrl}${PROBE.online.startPath}`;
const FETCH_TIMEOUT_MS = 30_000;
// Run BazaarLink kedaluwarsa 30 menit (dokumen resmi); beri margin 5 menit.
const ONLINE_RUN_TTL_MS = 35 * 60 * 1000;

// Suffix path endpoint yang di-strip dari transport.baseUrl registry agar
// menjadi base URL publik (BazaarLink menambahkan protocol path sendiri).
const ENDPOINT_SUFFIXES = ["/chat/completions", "/completions", "/messages", "/responses"];

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

// Simpan entri run + sapu entri kedaluwarsa setiap kali ada penulisan.
// Mengembalikan pollToken baru untuk ownership check di route polling/UI.
function simpanRun(runId, bazaarApiKey) {
  const store = onlineRunStore();
  const now = Date.now();
  for (const [k, v] of store) {
    if (now - (v?.createdAt || 0) > ONLINE_RUN_TTL_MS) store.delete(k);
  }
  const pollToken = crypto.randomUUID();
  store.set(runId, { bazaarApiKey: bazaarApiKey || null, pollToken, createdAt: now });
  return pollToken;
}

// Turunkan base URL publik dari transport.baseUrl registry
// (mis. ".../v1/chat/completions" -> ".../v1").
function turunkanBaseUrl(registryBaseUrl) {
  if (!registryBaseUrl || typeof registryBaseUrl !== "string") return null;
  let s = registryBaseUrl.trim();
  let berubah = true;
  while (berubah) {
    berubah = false;
    for (const suf of ENDPOINT_SUFFIXES) {
      if (s.toLowerCase().endsWith(suf) && s.length > suf.length) {
        s = s.slice(0, -suf.length);
        berubah = true;
      }
    }
  }
  return s || null;
}

// Petakan transport.format registry ke upstreamFormat BazaarLink.
// Skill resmi: opsional, default chat-completions bila dihilangkan; frontend
// resmi mengirim "anthropic" atau "openai". Nilai tak dikenal dinormalisasi
// server ke openai, jadi kirim eksplisit yang didukung saja.
function bazaarUpstreamFormat(entry) {
  const fmt = String(entry?.transport?.format || "").toLowerCase();
  if (fmt === "claude") return "anthropic";
  return "openai";
}

// Provider kustom (openai-compatible-*, anthropic-compatible-*) tidak ada di
// registry statis — bangun entri sintetis dari data koneksi tersimpan agar
// probe online tetap bisa jalan. Base URL diambil dari
// connection.providerSpecificData.baseUrl (sumber yang sama dipakai halaman
// daftar model & executor). Mengembalikan { entry } atau { error } —
// "missing-baseurl" bila base URL belum dikonfigurasi, "unknown" bila ID
// tidak cocok pola kustom manapun.
function entryCustomDariKoneksi(providerId, connection) {
  const baseUrlMentah = connection?.providerSpecificData?.baseUrl;
  if (!baseUrlMentah || typeof baseUrlMentah !== "string" || !baseUrlMentah.trim()) {
    return { error: "missing-baseurl" };
  }
  const baseUrl = baseUrlMentah.trim();
  if (isOpenAICompatibleProvider(providerId)) {
    return { entry: { id: providerId, transport: { baseUrl, format: "openai" } } };
  }
  if (isAnthropicCompatibleProvider(providerId)) {
    // format "claude" dipetakan bazaarUpstreamFormat() -> "anthropic".
    return { entry: { id: providerId, transport: { baseUrl, format: "claude" } } };
  }
  return { error: "unknown" };
}

// Validasi URL publik HTTPS: tolak localhost, IP privat, dan TLD lokal.
function isPublicHttps(urlString) {
  let u;
  try {
    u = new URL(urlString);
  } catch {
    return false;
  }
  if (u.protocol !== "https:") return false;
  // hostname IPv6 datang dengan kurung siku ("[::1]") — kupas dulu.
  const host = u.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (!host || host === "localhost") return false;
  if (host.endsWith(".local") || host.endsWith(".internal") || host.endsWith(".lan") || host.endsWith(".localhost")) {
    return false;
  }
  if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) {
    const [a, b] = host.split(".").map(Number);
    if (a === 10 || a === 127 || a === 0) return false;
    if (a === 172 && b >= 16 && b <= 31) return false;
    if (a === 192 && b === 168) return false;
    return true;
  }
  if (host.includes(":")) {
    // IPv6 literal: tolak loopback, link-local, dan unique-local.
    const first = host.split(":")[0];
    if (first === "" || first === "0" || first === "fe80") return false;
    if (/^(fc|fd)/i.test(first)) return false;
  }
  return true;
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

export async function POST(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Body bukan JSON yang valid" }, { status: 400 });
  }
  const { connectionId, modelId, claimedModel } = body || {};
  // bazaarApiKey: OPSIONAL dari client; default dari env server-side
  // (BAZAARLINK_API_KEY) agar tidak perlu input manual. TERVERIFIKASI:
  // endpoint publik tidak mewajibkannya — boleh kosong.
  let { bazaarApiKey } = body || {};
  if (!bazaarApiKey || typeof bazaarApiKey !== "string" || !bazaarApiKey.trim()) {
    bazaarApiKey = (process.env.BAZAARLINK_API_KEY || "").trim();
  } else {
    bazaarApiKey = bazaarApiKey.trim();
  }
  if (!connectionId || typeof connectionId !== "string") {
    return NextResponse.json({ error: "connectionId wajib diisi" }, { status: 400 });
  }
  if (!modelId || typeof modelId !== "string") {
    return NextResponse.json({ error: "modelId wajib diisi" }, { status: 400 });
  }

  // Guard flag fitur: 403 bila probe dimatikan di pengaturan.
  let settings = {};
  try {
    settings = await getSettings();
  } catch {
    // lanjut; langkah berikut butuh DB juga
  }
  if (settings?.probeEnabled === false) {
    return NextResponse.json({ error: "Probe dinonaktifkan di pengaturan" }, { status: 403 });
  }

  // Resolve koneksi aktif server-side (klien tidak pernah kirim upstream key).
  let connection = null;
  try {
    const connections = await getProviderConnections({ isActive: true });
    connection = (connections || []).find((c) => c?.id === connectionId) || null;
  } catch (e) {
    return NextResponse.json({ error: `Gagal membaca koneksi: ${pesanAman(e)}` }, { status: 500 });
  }
  if (!connection) {
    return NextResponse.json({ error: "Koneksi tidak ditemukan / tidak aktif" }, { status: 400 });
  }
  const providerId = connection.provider;
  let entry = REGISTRY.find((r) => r.id === providerId) || null;
  if (!entry) {
    // Provider kustom tidak ada di registry statis — coba bangun entri
    // sintetis dari koneksi tersimpan. Probe LLM hanya untuk model chat;
    // provider embedding ditolak eksplisit.
    if (isCustomEmbeddingProvider(providerId)) {
      return NextResponse.json(
        { error: "Probe tidak didukung untuk provider embedding" },
        { status: 400 }
      );
    }
    const custom = entryCustomDariKoneksi(providerId, connection);
    if (custom.error === "missing-baseurl") {
      return NextResponse.json(
        { error: "Base URL belum dikonfigurasi untuk provider kustom ini" },
        { status: 400 }
      );
    }
    if (!custom.entry) {
      return NextResponse.json({ error: "Provider tidak dikenal di registry" }, { status: 400 });
    }
    entry = custom.entry;
  }

  // Skip eksplisit (pola meniru check-models): cookie butuh sesi browser,
  // aws-sigv4 butuh penandatanganan khusus. OAuth BOLEH lanjut.
  const authType = connection.authType || entry?.authType || "apikey";
  if (authType === "cookie") {
    return NextResponse.json(
      { error: "Probe tidak didukung untuk koneksi ini", reason: "koneksi cookie butuh sesi browser" },
      { status: 400 }
    );
  }
  if (entry?.transport?.authHeader === "aws-sigv4") {
    return NextResponse.json(
      { error: "Probe tidak didukung untuk koneksi ini", reason: "butuh penandatanganan AWS SigV4" },
      { status: 400 }
    );
  }

  // Resolve kredensial server-side; mismatch connectionId -> 409 (tanpa
  // fallback ke akun lain — meniru pola replay route).
  let credentials;
  try {
    credentials = await getProviderCredentials(providerId, null, null, { preferredConnectionId: connectionId });
  } catch (e) {
    return NextResponse.json({ error: `Gagal resolve koneksi: ${pesanAman(e)}` }, { status: 500 });
  }
  if (!credentials || credentials.connectionId !== connectionId) {
    return NextResponse.json(
      { error: "Koneksi asal tidak tersedia (mungkin terkunci/nonaktif). Probe dibatalkan agar tidak memakai akun lain." },
      { status: 409 }
    );
  }
  try {
    credentials = await checkAndRefreshToken(providerId, credentials);
  } catch (e) {
    return NextResponse.json({ error: `Gagal refresh kredensial: ${pesanAman(e)}` }, { status: 500 });
  }

  // ASUMSI: untuk koneksi OAuth tidak ada apiKey mentah; pakai accessToken
  // sebagai bearer bila tersedia. Perlu verifikasi via run aktual.
  const upstreamApiKey = credentials.apiKey || credentials.accessToken || null;
  if (!upstreamApiKey) {
    return NextResponse.json(
      { error: "Koneksi tidak menyimpan API key upstream untuk probe online" },
      { status: 400 }
    );
  }

  // Base URL upstream PUBLIK — bukan localhost 9router (private ditolak 400).
  const baseUrl = turunkanBaseUrl(entry.transport?.baseUrl);
  if (!baseUrl || !isPublicHttps(baseUrl)) {
    return NextResponse.json({ error: "Base URL harus HTTPS publik" }, { status: 400 });
  }

  // Start-run async (sync: false) sesuai rekomendasi dokumen resmi.
  // upstreamFormat dikirim eksplisit dari transport.format registry agar
  // BazaarLink tidak menebak protokol dari URL (autodeteksi host tidak
  // didukung menurut verifikasi). lang: "en" meminta teks probe (label &
  // passReason tiap item) dalam bahasa Inggris — tanpa ini BazaarLink
  // mengembalikan Mandarin Tradisional.
  const payload = {
    baseUrl,
    apiKey: upstreamApiKey,
    modelId,
    upstreamFormat: bazaarUpstreamFormat(entry),
    sync: false,
    lang: "en",
  };
  if (claimedModel && typeof claimedModel === "string" && claimedModel.trim()) {
    payload.claimedModel = claimedModel.trim();
  }

  // Header auth HANYA bila key tersedia. TERVERIFIKASI: endpoint publik
  // menerima run tanpa Authorization; Bearer admin hanya untuk bypass
  // rate limit — jangan mengirim "Bearer " kosong/invalid.
  const bazaarHeaders = { "Content-Type": "application/json" };
  if (bazaarApiKey) bazaarHeaders.Authorization = `Bearer ${bazaarApiKey}`;

  let res;
  try {
    res = await fetch(BAZAAR_PROBE_RUN_URL, {
      method: "POST",
      headers: bazaarHeaders,
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
  } catch (e) {
    return NextResponse.json({ error: `Start-run gagal: ${pesanAman(e)}` }, { status: 502 });
  }

  if (res.status === 429) return teruskanRateLimit(res);
  if (!res.ok) {
    const peta = { 400: "invalid_request", 403: "forbidden", 502: "bad_gateway", 503: "unavailable" };
    const code = peta[res.status] || "probe_failed";
    const status = res.status === 400 || res.status === 403 ? res.status : 502;
    const teks = await res.text().catch(() => "");
    return NextResponse.json(
      { error: `BazaarLink: ${pesanAman(teks.slice(0, 200)) || `HTTP ${res.status}`}`, code },
      { status }
    );
  }

  let data;
  try {
    data = await res.json();
  } catch {
    return NextResponse.json({ error: "Probe gagal: respons BazaarLink tidak valid", code: "invalid_response" }, { status: 502 });
  }
  if (!data?.runId || typeof data.runId !== "string") {
    return NextResponse.json({ error: "Probe gagal: runId tidak valid", code: "invalid_response" }, { status: 502 });
  }

  // Simpan bazaarApiKey (atau null) di memori SAJA (maks 35 menit) untuk
  // polling server-side — tidak ke DB/file/log. pollToken dikembalikan ke
  // klien sebagai bukti kepemilikan run (verifikasi: polling BazaarLink
  // publik tanpa auth, jadi kepemilikan dicek di aplikasi sendiri).
  const pollToken = simpanRun(data.runId, bazaarApiKey || null);

  // Log minimal — tanpa key dalam bentuk apapun (syarat wajib RULES.md).
  console.log("[Probe] online start", { providerId, modelId, connectionId, runId: data.runId });

  // TERVERIFIKASI: acknowledgement async HANYA berisi runId — status awal
  // "running" adalah state lokal, bukan dari respons BazaarLink.
  return NextResponse.json({ ok: true, runId: data.runId, pollToken, status: "running" });
}
