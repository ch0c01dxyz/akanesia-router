import { NextResponse } from "next/server";
import { getProviderConnections } from "@/models";
import { getSettings } from "@/lib/db/repos/settingsRepo.js";
import { getOrRefresh, invalidate } from "@/lib/checkModelsCache.js";
import REGISTRY from "open-sse/providers/registry/index.js";
import { AI_PROVIDERS, isOpenAICompatibleProvider, isAnthropicCompatibleProvider } from "@/shared/constants/providers";
import { FILTERS } from "../suggested-models/filters.js";
import { autoDisableSuspendedAccount, isSuspensionSignal } from "open-sse/utils/accountSuspension.js";

export const dynamic = "force-dynamic";

const FETCH_TIMEOUT_MS = 15000;
const CONCURRENCY = 5;

// Build auth headers for a models-list check from the registry's auth schema.
// Returns { headers } or { skipped, reason } when the auth type can't be checked.
function buildCheckHeaders(entry, connection) {
  const authType = entry?.authType || "apikey";
  const authHeader = entry?.transport?.authHeader;

  // OAuth providers: no public models endpoint; skip unless a public fetcher exists.
  if (authType === "oauth") {
    return { skipped: true, reason: "oauth — no public models endpoint" };
  }
  // Providers that need AWS SigV4 signing can't be checked with a plain fetch.
  if (authHeader === "aws-sigv4") {
    return { skipped: true, reason: "aws-sigv4 signing required" };
  }
  // Cookie/session providers need a browser session, not an API key.
  if (authType === "cookie") {
    return { skipped: true, reason: "cookie session required" };
  }
  // Explicit no-auth providers: check without credentials.
  if (authHeader === "none" || authType === "none") {
    return { headers: {} };
  }

  const apiKey = connection?.apiKey;
  // Optional-auth providers can be checked anonymously when no key is stored.
  if (!apiKey) {
    if (authType === "optional") return { headers: {} };
    return { skipped: true, reason: "API key belum diatur — tambahkan API key pada koneksi terlebih dahulu" };
  }

  const headers = {};
  switch (authHeader) {
    case "bearer":
    case "authorization":
      headers["Authorization"] = authHeader === "bearer" ? `Bearer ${apiKey}` : apiKey;
      break;
    case "basic":
      headers["Authorization"] = `Basic ${apiKey}`;
      break;
    case undefined:
    case null:
      // Registry default: Bearer <redacted>
      headers["Authorization"] = `Bearer ${apiKey}`;
      break;
    case "key":
      // Query-param auth (e.g. Gemini-style ?key=). Handled by the caller via url.
      return { headers, queryKey: apiKey };
    default:
      // Raw key in a custom header (x-api-key, xi-api-key, api-key, ...).
      headers[authHeader] = apiKey;
  }
  return { headers };
}

// Extract model ids from common list shapes:
// OpenAI {data:[{id}]}, Gemini {models:[{name}]}, or a bare array.
function parseModelIds(json) {
  const ids = [];
  const push = (v) => {
    if (typeof v === "string" && v && !ids.includes(v)) ids.push(v);
  };
  if (Array.isArray(json?.data)) json.data.forEach((m) => push(m?.id));
  else if (Array.isArray(json?.models))
    json.models.forEach((m) => push(m?.id || (typeof m?.name === "string" ? m.name.replace(/^models\//, "") : null)));
  else if (Array.isArray(json)) json.forEach((m) => push(m?.id));
  return ids;
}

function baseResult(providerId) {
  const info = AI_PROVIDERS[providerId];
  return {
    provider: providerId,
    name: info?.name || providerId,
  };
}

async function checkWithConnection(providerId, connection) {
  const entry = REGISTRY.find((r) => r.id === providerId);
  const validateUrl = entry?.transport?.validateUrl;
  if (!validateUrl) {
    return { ...baseResult(providerId), ok: false, skipped: true, reason: "no models endpoint" };
  }
  const auth = buildCheckHeaders(entry, connection);
  if (auth.skipped) {
    return { ...baseResult(providerId), ok: false, skipped: true, reason: auth.reason };
  }
  const start = Date.now();
  try {
    let url = validateUrl;
    if (auth.queryKey) {
      const sep = url.includes("?") ? "&" : "?";
      url = `${url}${sep}key=${encodeURIComponent(auth.queryKey)}`;
    }
    const res = await fetch(url, {
      headers: auth.headers,
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    const latencyMs = Date.now() - start;
    if (!res.ok) {
      // Baca body error (dibatasi) untuk deteksi sinyal suspend.
      const errorBody = await res.text().then((t) => t.slice(0, 2000)).catch(() => "");
      return { ...baseResult(providerId), ok: false, error: `HTTP ${res.status}`, httpStatus: res.status, errorBody, latencyMs, source: "connection" };
    }
    const json = await res.json().catch(() => null);
    const models = parseModelIds(json);
    return {
      ...baseResult(providerId),
      ok: true,
      modelCount: models.length,
      models,
      latencyMs,
      source: "connection",
      connectionName: connection.name || connection.email || null,
    };
  } catch (err) {
    return { ...baseResult(providerId), ok: false, error: err?.message || "request failed", latencyMs: Date.now() - start, source: "connection" };
  }
}

// Check via koneksi untuk provider kompatibel dinamis (openai-compatible-* /
// anthropic-compatible-*) yang tidak punya entry registry / validateUrl.
// Memakai baseUrl koneksi + /models — logika yang sama dengan endpoint
// "Import from /models" (GET /api/providers/[id]/models).
// Mengembalikan objek hasil, atau null bila tidak applicable.
export async function checkViaConnectionBaseUrl(providerId, connection, fetchFn = fetch) {
  const baseUrl = connection?.providerSpecificData?.baseUrl;
  if (!baseUrl || !(isOpenAICompatibleProvider(providerId) || isAnthropicCompatibleProvider(providerId))) {
    return null;
  }
  // API key belum diatur: jangan kirim request sia-sia, kembalikan warning
  // agar pengguna diminta menambahkan API key terlebih dahulu.
  if (!connection?.apiKey) {
    return {
      ...baseResult(providerId),
      name: connection?.name || baseResult(providerId).name,
      ok: false,
      skipped: true,
      reason: "API key belum diatur — tambahkan API key pada koneksi terlebih dahulu",
      source: "connection",
      connectionName: connection?.name || connection?.email || null,
    };
  }
  let url;
  let headers;
  if (isOpenAICompatibleProvider(providerId)) {
    url = `${baseUrl.replace(/\/$/, "")}/models`;
    headers = { "Content-Type": "application/json", "Authorization": `Bearer ${connection.apiKey}` };
  } else {
    let base = baseUrl.replace(/\/$/, "");
    if (base.endsWith("/messages")) base = base.slice(0, -9);
    url = `${base}/models`;
    headers = {
      "Content-Type": "application/json",
      "x-api-key": connection.apiKey,
      "anthropic-version": "2023-06-01",
    };
  }
  const start = Date.now();
  try {
    const res = await fetchFn(url, { headers, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    const latencyMs = Date.now() - start;
    if (!res.ok) {
      const errorBody = await res.text().then((t) => t.slice(0, 2000)).catch(() => "");
      return {
        ...baseResult(providerId),
        name: connection.name || baseResult(providerId).name,
        ok: false,
        error: `HTTP ${res.status}`,
        httpStatus: res.status,
        errorBody,
        latencyMs,
        source: "connection",
        connectionName: connection.name || connection.email || null,
      };
    }
    const json = await res.json().catch(() => null);
    const models = parseModelIds(json);
    return {
      ...baseResult(providerId),
      name: connection.name || baseResult(providerId).name,
      ok: true,
      modelCount: models.length,
      models,
      latencyMs,
      source: "connection",
      connectionName: connection.name || connection.email || null,
    };
  } catch (err) {
    return {
      ...baseResult(providerId),
      name: connection.name || baseResult(providerId).name,
      ok: false,
      error: err?.message || "request failed",
      latencyMs: Date.now() - start,
      source: "connection",
      connectionName: connection.name || connection.email || null,
    };
  }
}

async function checkPublic(providerId) {
  const fetcher = AI_PROVIDERS[providerId]?.modelsFetcher;
  if (!fetcher?.url || !fetcher?.type) return null;
  const start = Date.now();
  try {
    const res = await fetch(fetcher.url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    const latencyMs = Date.now() - start;
    if (!res.ok) {
      return { ...baseResult(providerId), ok: false, error: `HTTP ${res.status}`, latencyMs, source: "public" };
    }
    const json = await res.json().catch(() => null);
    const raw = json?.data ?? json?.models ?? json;
    const filter = FILTERS[fetcher.type];
    const data = filter ? filter(Array.isArray(raw) ? raw : []) : [];
    const models = data.map((m) => m?.id).filter((id) => typeof id === "string" && id);
    return { ...baseResult(providerId), ok: true, modelCount: models.length, models, latencyMs, source: "public" };
  } catch (err) {
    return { ...baseResult(providerId), ok: false, error: err?.message || "request failed", latencyMs: Date.now() - start, source: "public" };
  }
}

// Bounded concurrency pool so one slow provider can't stall the batch.
async function mapPool(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  const workers = new Array(Math.min(limit, items.length)).fill(null).map(async () => {
    while (next < items.length) {
      const i = next++;
      try {
        out[i] = await fn(items[i], i);
      } catch (err) {
        out[i] = { provider: items[i], ok: false, error: err?.message || "failed" };
      }
    }
  });
  await Promise.allSettled(workers); // satu worker gagal ≠ batch mati (ide #1)
  return out;
}

// Lapisan cache di atas logika check per-provider.
// Hanya hasil ok:true yang di-cache; error/skip selalu di-fetch ulang tiap
// request (tidak pernah di-cache). Hasil yang berasal dari cache — baik fresh
// maupun stale — ditandai { cached: true } agar UI bisa menampilkan status
// staleness. Field ini aditif; field existing tidak diubah.
async function checkProviderWithCache(pid, conn, ttlSeconds, forceRefresh) {
  const entry = REGISTRY.find((r) => r.id === pid);
  const fetchAsli = async () => {
    // Prefer the stored connection; buildCheckHeaders handles bearer, raw-key,
    // custom headers, none/optional, and skips oauth/cookie/sigv4 explicitly.
    if (entry?.transport?.validateUrl) {
      return checkWithConnection(pid, conn);
    }
    // Provider kompatibel dinamis (openai-compatible-*/anthropic-compatible-*)
    // tanpa entry registry: cek via baseUrl koneksinya sendiri.
    if (conn) {
      const viaConn = await checkViaConnectionBaseUrl(pid, conn);
      if (viaConn) return viaConn;
    }
    const pub = await checkPublic(pid);
    if (pub) return pub;
    return {
      ...baseResult(pid),
      ok: false,
      skipped: true,
      reason: conn ? "no models endpoint for this provider" : "no active connection",
    };
  };

  // Refresh manual per provider: invalidate entry lama lalu biarkan alur
  // normal di bawah berjalan (akan miss → fetch singleflight → simpan ke
  // cache), sehingga data segar dari tombol refresh ikut tersimpan untuk
  // request berikutnya. Hanya hasil ok:true yang di-cache (lihat bolehCache).
  if (forceRefresh) {
    invalidate(pid);
  }

  const { result, hit } = await getOrRefresh(pid, ttlSeconds, fetchAsli, {
    bolehCache: (hasil) => hasil?.ok === true,
  });
  return hit === "miss" ? result : { ...result, cached: true };
}

// Inti check satu provider — dipakai route POST (via batch di bawah) dan
// scheduler auto-sync ide #6 (src/lib/checkModelsAutoSync.js).
// forceRefresh: invalidate cache dulu lalu fetch ulang (hasil ok:true
// kembali ditulis ke cache ide #3).
export async function checkProviderModels(providerId, { forceRefresh = false } = {}) {
  let connections = [];
  try {
    connections = await getProviderConnections({ isActive: true });
  } catch {
    connections = [];
  }
  const conn = (connections || []).find((c) => c?.provider === providerId) || null;

  let ttlSeconds = 3600;
  try {
    const settings = await getSettings();
    const n = Number(settings?.checkModelsTtlSeconds);
    if (Number.isFinite(n)) ttlSeconds = n;
  } catch {
    // pakai default
  }

  return checkProviderWithCache(providerId, conn, ttlSeconds, forceRefresh);
}

// POST /api/providers/check-models - Check available models for providers
// Body: { mode: "all" } | { mode: "provider", providerId }
// Uses the active API-key connection when present, otherwise the provider's
// public models fetcher. Providers with neither are reported as skipped.
export async function POST(request) {
  try {
    const body = await request.json().catch(() => ({}));
    const { mode = "all", providerId = null, forceRefresh = false } = body;

    let targetIds;
    if (mode === "provider" && providerId) {
      targetIds = [providerId];
    } else if (mode === "all") {
      targetIds = REGISTRY.filter((r) => r.transport?.validateUrl || r.modelsFetcher).map((r) => r.id);
    } else {
      return NextResponse.json(
        { error: "Invalid mode. Use: all, provider" },
        { status: 400 }
      );
    }

    let connections = [];
    try {
      connections = await getProviderConnections({ isActive: true });
    } catch {
      connections = [];
    }
    const connByProvider = new Map();
    for (const c of connections || []) {
      if (c?.provider && !connByProvider.has(c.provider)) connByProvider.set(c.provider, c);
    }

    // TTL cache dari settings; 0 (atau tidak valid) = cache mati total.
    const settings = await getSettings();
    let ttlSeconds = Number(settings?.checkModelsTtlSeconds);
    if (!Number.isFinite(ttlSeconds)) ttlSeconds = 3600;
    // Toggle auto-disable akun suspend dari Check Models (default OFF).
    const suspendAutoDisableOnCheck = settings?.suspendAutoDisableOnCheck === true;

    const results = await mapPool(targetIds, CONCURRENCY, async (pid) => {
      const conn = connByProvider.get(pid);
      const result = await checkProviderWithCache(pid, conn, ttlSeconds, forceRefresh);
      // Auto-disable opsional dari Check Models (default OFF — toggle di
      // Dashboard > Endpoint & Key > Insiden Kuota & Error). Hanya untuk
      // sinyal suspend yang ketat (403/423 + "suspend"); error lain tidak
      // memicu apa-apa.
      if (
        suspendAutoDisableOnCheck &&
        !result.ok && !result.skipped &&
        isSuspensionSignal(result.httpStatus, result.errorBody)
      ) {
        try {
          const disabled = await autoDisableSuspendedAccount({
            connectionId: conn?.id,
            provider: pid,
            status: result.httpStatus,
            message: result.errorBody,
            credentials: conn,
          });
          if (disabled) result.autoDisabled = true;
        } catch {
          // abaikan — fail-open
        }
      }
      return result;
    });

    const summary = {
      total: results.length,
      ok: results.filter((r) => r.ok).length,
      failed: results.filter((r) => !r.ok && !r.skipped).length,
      skipped: results.filter((r) => r.skipped).length,
    };

    return NextResponse.json({
      mode,
      providerId: providerId || null,
      results,
      summary,
      checkedAt: new Date().toISOString(),
    });
  } catch (err) {
    return NextResponse.json(
      { error: err?.message || "Check models failed" },
      { status: 500 }
    );
  }
}
