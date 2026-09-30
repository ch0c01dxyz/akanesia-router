// POST /api/probe/offline — menjalankan baterai fingerprinting offline (ide 5c).
//
// Klien hanya mengirim connectionId (+ modelId); API key upstream selalu
// di-resolve server-side dari koneksi tersimpan dan TIDAK PERNAH dikirim ke
// browser, ke log, atau ke response. Prinsip redaksi meniru ide #7
// (src/lib/requestReplayBuffer.js): nol secret di response/log.
//
// Kontrak service: open-sse/services/probe.js menyediakan
// runOfflineProbe({ providerId, modelId, credentials, reference, onProgress })
// dan loadReferenceFingerprint(providerId, modelId).

import { NextResponse } from "next/server";
import { getProviderConnections } from "@/models";
import { getSettings } from "@/lib/db/repos/settingsRepo.js";
import { getProviderCredentials } from "@/sse/services/auth.js";
import { checkAndRefreshToken } from "@/sse/services/tokenRefresh.js";
import { runOfflineProbe, loadReferenceFingerprint } from "open-sse/services/probe.js";
import REGISTRY from "open-sse/providers/registry/index.js";

export const dynamic = "force-dynamic";

// Penyimpanan progres in-memory (hilang saat restart — disengaja, tidak ada
// state probe yang ditulis ke DB/file). Entri kedaluwarsa > 5 menit.
const PROGRESS_TTL_MS = 5 * 60 * 1000;

function progressStore() {
  if (!globalThis.__probeProgress) globalThis.__probeProgress = new Map();
  return globalThis.__probeProgress;
}

// Tulis progres + sapu entri kedaluwarsa setiap kali ada penulisan.
function tulisProgres(runId, done, total) {
  const store = progressStore();
  const now = Date.now();
  for (const [k, v] of store) {
    if (now - (v?.updatedAt || 0) > PROGRESS_TTL_MS) store.delete(k);
  }
  store.set(runId, { done, total, updatedAt: now });
}

// Samarkan pola secret yang mungkin lolos ke pesan error agar tidak bocor
// ke response (fail-closed untuk redaksi).
function pesanAman(err) {
  const msg = String(err?.message || err || "kesalahan tidak dikenal").slice(0, 300);
  return msg
    .replace(/sk-[A-Za-z0-9_-]{8,}/g, "<redacted>")
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer <redacted>")
    .replace(/(api[_-]?key\s*[:=]\s*)\S+/gi, "$1<redacted>");
}

// Guard flag fitur: 403 bila probe dimatikan di pengaturan.
async function probeDimatikan() {
  try {
    const settings = await getSettings();
    return settings?.probeEnabled === false;
  } catch {
    return false; // gagal baca settings -> lanjut; langkah berikut butuh DB juga
  }
}

// Resolve koneksi aktif dari connectionId; 400 bila tidak ada/tidak aktif.
// Mengembalikan { connection, providerId, entry } atau { error: NextResponse }.
async function resolveKoneksi(connectionId) {
  let connections = [];
  try {
    connections = await getProviderConnections({ isActive: true });
  } catch (e) {
    return { error: NextResponse.json({ error: `Gagal membaca koneksi: ${pesanAman(e)}` }, { status: 500 }) };
  }
  const connection = (connections || []).find((c) => c?.id === connectionId) || null;
  if (!connection) {
    return { error: NextResponse.json({ error: "Koneksi tidak ditemukan / tidak aktif" }, { status: 400 }) };
  }
  const providerId = connection.provider;
  const entry = REGISTRY.find((r) => r.id === providerId) || null;

  // Skip eksplisit (pola meniru check-models): cookie butuh sesi browser,
  // aws-sigv4 butuh penandatanganan khusus. OAuth BOLEH lanjut
  // (executor menanganinya, sama seperti alur request normal).
  const authType = connection.authType || entry?.authType || "apikey";
  if (authType === "cookie") {
    return {
      error: NextResponse.json(
        { error: "Probe tidak didukung untuk koneksi ini", reason: "koneksi cookie butuh sesi browser" },
        { status: 400 }
      ),
    };
  }
  if (entry?.transport?.authHeader === "aws-sigv4") {
    return {
      error: NextResponse.json(
        { error: "Probe tidak didukung untuk koneksi ini", reason: "butuh penandatanganan AWS SigV4" },
        { status: 400 }
      ),
    };
  }
  return { connection, providerId, entry };
}

// Resolve kredensial server-side untuk connectionId persis — tanpa fallback
// ke akun lain (meniru pola replay route: mismatch -> 409).
// Mengembalikan { credentials } atau { error: NextResponse }.
async function resolveKredensial(providerId, connectionId) {
  let credentials;
  try {
    credentials = await getProviderCredentials(providerId, null, null, { preferredConnectionId: connectionId });
  } catch (e) {
    return { error: NextResponse.json({ error: `Gagal resolve koneksi: ${pesanAman(e)}` }, { status: 500 }) };
  }
  if (!credentials || credentials.connectionId !== connectionId) {
    return {
      error: NextResponse.json(
        { error: "Koneksi asal tidak tersedia (mungkin terkunci/nonaktif). Probe dibatalkan agar tidak memakai akun lain." },
        { status: 409 }
      ),
    };
  }
  try {
    return { credentials: await checkAndRefreshToken(providerId, credentials) };
  } catch (e) {
    return { error: NextResponse.json({ error: `Gagal refresh kredensial: ${pesanAman(e)}` }, { status: 500 }) };
  }
}

// Pertahanan berlapis: pastikan objek credentials / field secret tidak
// pernah ikut ke response, walau service mengembalikannya.
function buangKredensialTopLevel(obj) {
  for (const k of [
    "credentials",
    "apiKey",
    "api_key",
    "accessToken",
    "refreshToken",
    "idToken",
    "secret",
    "authorization",
    "authHeaders",
  ]) {
    if (obj && typeof obj === "object" && k in obj) delete obj[k];
  }
  return obj;
}

export async function POST(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Body bukan JSON yang valid" }, { status: 400 });
  }
  const { connectionId, modelId, clientRunId } = body || {};
  if (!connectionId || typeof connectionId !== "string") {
    return NextResponse.json({ error: "connectionId wajib diisi" }, { status: 400 });
  }
  if (!modelId || typeof modelId !== "string") {
    return NextResponse.json({ error: "modelId wajib diisi" }, { status: 400 });
  }

  if (await probeDimatikan()) {
    return NextResponse.json({ error: "Probe dinonaktifkan di pengaturan" }, { status: 403 });
  }

  const koneksi = await resolveKoneksi(connectionId);
  if (koneksi.error) return koneksi.error;
  const { providerId } = koneksi;

  const kred = await resolveKredensial(providerId, connectionId);
  if (kred.error) return kred.error;

  // Fingerprint referensi: null bila belum ada — bukan error (engine verdict
  // yang menentukan hasil saat referensi absen). Versi async: wajib di-await
  // agar yang diteruskan ke service berupa objek, bukan Promise.
  let reference = null;
  try {
    reference = (await loadReferenceFingerprint(providerId, modelId)) || null;
  } catch {
    reference = null;
  }

  const runId = typeof clientRunId === "string" && clientRunId ? clientRunId : null;
  const t0 = Date.now();
  let report;
  try {
    report = await runOfflineProbe({
      providerId,
      modelId,
      credentials: kred.credentials,
      reference,
      // Dibungkus aman: kegagalan tulis progres tidak boleh menggagalkan probe.
      onProgress: (done, total) => {
        if (!runId) return;
        try {
          tulisProgres(runId, done, total);
        } catch {
          // abaikan — progres hanya UX
        }
      },
    });
  } catch (e) {
    return NextResponse.json({ error: `Probe gagal: ${pesanAman(e)}` }, { status: 500 });
  }
  if (!report || typeof report !== "object") {
    return NextResponse.json({ error: "Probe gagal: hasil tidak valid" }, { status: 500 });
  }
  const latencyMs = Date.now() - t0;

  // Log minimal — tanpa header/body/key (syarat wajib RULES.md).
  console.log("[Probe] offline", { providerId, modelId, connectionId, latencyMs, verdict: report.verdict });

  const payload = buangKredensialTopLevel({
    ok: true,
    ...report,
    meta: { ...(report.meta || {}), connectionId },
  });
  return NextResponse.json(payload);
}
