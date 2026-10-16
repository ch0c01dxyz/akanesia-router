// Logika test proxy pool — dipakai route manual test dan health monitor otomatis.
import { testProxyUrl } from "@/lib/network/proxyTest";
import { fetch as undiciFetch } from "undici";

const RELAY_TYPES = new Set(["vercel", "cloudflare", "deno", "netlify"]);

export async function testVercelRelay(relayUrl, timeoutMs = 10000) {
  const controller = new AbortController();
  const startedAt = Date.now();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await undiciFetch(relayUrl, {
      method: "GET",
      headers: {
        "x-relay-target": "https://httpbin.org",
        "x-relay-path": "/get",
      },
      signal: controller.signal,
    });
    return {
      ok: res.ok,
      status: res.status,
      statusText: res.statusText,
      elapsedMs: Date.now() - startedAt,
    };
  } catch (err) {
    return {
      ok: false,
      status: 500,
      error: err?.name === "AbortError" ? "Relay test timed out" : (err?.message || String(err)),
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Test satu proxy pool. Mengembalikan { ok, status, statusText?, error?, elapsedMs? }.
 * Gagal pada: timeout, connection refused, HTTP error, limit tercapai.
 */
export async function testProxyPool(pool, timeoutMs = 10000) {
  if (!pool?.proxyUrl) return { ok: false, status: 400, error: "proxyUrl is required" };
  if (RELAY_TYPES.has(pool.type)) {
    return testVercelRelay(pool.proxyUrl, timeoutMs);
  }
  return testProxyUrl({ proxyUrl: pool.proxyUrl, timeoutMs });
}
