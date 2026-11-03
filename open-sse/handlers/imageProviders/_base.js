// Shared helpers for image provider adapters

import { fetchPublic } from "../../../src/shared/utils/ssrfGuard.js";
import { MAX_IMAGE_BYTES, FETCH_TIMEOUT_MS } from "../../config/mediaConfig.js";

export const POLL_INTERVAL_MS = 1500;
export const POLL_TIMEOUT_MS = 120000;

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Map OpenAI size to provider-specific aspect ratio
export function sizeToAspectRatio(size) {
  if (!size || typeof size !== "string") return "1:1";
  const map = {
    "1024x1024": "1:1",
    "1024x1792": "9:16",
    "1792x1024": "16:9",
    "1024x1536": "2:3",
    "1536x1024": "3:2",
  };
  return map[size] || "1:1";
}

// Fetch URL → base64. SSRF-guarded via fetchPublic (literal + DNS + redirect
// targets re-validated) and bounded by timeout + byte cap — the previous plain
// fetch() let any caller-supplied image URL reach internal hosts and buffer an
// unbounded payload into memory. Throws on block/cap/timeout/non-ok, like before.
export async function urlToBase64(url, { timeoutMs = FETCH_TIMEOUT_MS, maxBytes = MAX_IMAGE_BYTES } = {}) {
  const signal = typeof AbortSignal?.timeout === "function" ? AbortSignal.timeout(timeoutMs) : undefined;
  const res = await fetchPublic(url, signal ? { signal } : {});
  if (!res.ok) throw new Error(`Failed to fetch image: ${res.status}`);
  if (!res.body) throw new Error("Failed to fetch image: empty body");
  const reader = res.body.getReader();
  const chunks = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > maxBytes) {
      try { await reader.cancel(); } catch { /* ignore */ }
      throw new Error(`Failed to fetch image: exceeds ${maxBytes} bytes`);
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks.map((c) => Buffer.from(c))).toString("base64");
}

export function nowSec() {
  return Math.floor(Date.now() / 1000);
}
