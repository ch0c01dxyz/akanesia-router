import { NextResponse } from "next/server";
import { getReplayEntry } from "@/lib/requestReplayBuffer.js";
import { getProviderCredentials } from "@/sse/services/auth.js";
import { checkAndRefreshToken } from "@/sse/services/tokenRefresh.js";
import { getExecutor } from "open-sse/executors/index.js";

export const dynamic = "force-dynamic";

// Replay dijalankan non-streaming agar hasilnya ringkas (status + cuplikan).
// Timeout 90 detik; respons hanya cuplikan untuk UI.
const REPLAY_TIMEOUT_MS = 90_000;
const REPLAY_SNIPPET_MAX_CHARS = 4096;

// POST /api/replay-log/[id]/replay — Kirim ulang request upstream memakai
// pipeline executor yang sama dengan request asli dan koneksi tersimpan
// (resolve connectionId server-side seperti alur normal; kredensial TIDAK
// pernah dibaca dari entry karena header sudah di-redact saat capture).
// Body opsional: { body } (objek atau string JSON) untuk edit sebelum kirim.
export async function POST(request, { params }) {
  const { id } = await params;
  const entry = getReplayEntry(id);
  if (!entry) {
    return NextResponse.json({ error: "Replay entry tidak ditemukan" }, { status: 404 });
  }

  // Body replay: dari editor, atau body asli yang tercapture.
  let replayBody;
  try {
    const payload = await request.json().catch(() => ({}));
    if (payload && payload.body !== undefined && payload.body !== null && payload.body !== "") {
      replayBody = typeof payload.body === "string" ? JSON.parse(payload.body) : payload.body;
    } else {
      replayBody = JSON.parse(entry.requestBody || "{}");
    }
  } catch {
    return NextResponse.json({ error: "Body bukan JSON yang valid" }, { status: 400 });
  }
  if (!replayBody || typeof replayBody !== "object" || Array.isArray(replayBody)) {
    return NextResponse.json({ error: "Body harus berupa objek JSON" }, { status: 400 });
  }

  // Resolve koneksi tersimpan server-side (mekanisme sama seperti request normal).
  let credentials;
  try {
    credentials = await getProviderCredentials(entry.provider, null, null, {
      preferredConnectionId: entry.connectionId || null,
    });
  } catch (e) {
    return NextResponse.json({ error: `Gagal resolve koneksi: ${e?.message || e}` }, { status: 500 });
  }
  if (!credentials || credentials.allRateLimited || credentials.connectionId !== entry.connectionId) {
    return NextResponse.json(
      { error: "Koneksi asal tidak tersedia (mungkin terkunci/nonaktif). Replay dibatalkan agar tidak memakai akun lain." },
      { status: 409 }
    );
  }

  // Refresh token OAuth bila perlu (sama seperti alur request normal).
  let refreshed = credentials;
  try {
    refreshed = await checkAndRefreshToken(entry.provider, credentials);
  } catch (e) {
    return NextResponse.json({ error: `Gagal refresh kredensial: ${e?.message || e}` }, { status: 500 });
  }

  const executor = await getExecutor(entry.provider);
  const psd = refreshed?.providerSpecificData || {};
  const proxyOptions = {
    connectionProxyEnabled: psd.connectionProxyEnabled === true,
    connectionProxyUrl: psd.connectionProxyUrl || "",
    connectionNoProxy: psd.connectionNoProxy || "",
    vercelRelayUrl: psd.vercelRelayUrl || "",
  };

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(new Error("replay timeout")), REPLAY_TIMEOUT_MS);
  const t0 = Date.now();
  try {
    const result = await executor.execute({
      model: entry.model,
      body: replayBody,
      stream: false,
      credentials: refreshed,
      signal: ctrl.signal,
      proxyOptions,
    });
    const text = await result.response.text().catch(() => "");
    return NextResponse.json({
      ok: result.response.ok,
      status: result.response.status,
      latencyMs: Date.now() - t0,
      url: result.url || entry.url,
      snippet: text.slice(0, REPLAY_SNIPPET_MAX_CHARS),
      truncated: text.length > REPLAY_SNIPPET_MAX_CHARS,
    });
  } catch (e) {
    const isAbort = e?.name === "AbortError";
    return NextResponse.json(
      {
        ok: false,
        status: isAbort ? 504 : 502,
        latencyMs: Date.now() - t0,
        error: isAbort ? "Replay timeout (90 detik)" : (e?.message || String(e)),
      },
      { status: isAbort ? 504 : 502 }
    );
  } finally {
    clearTimeout(timer);
  }
}
