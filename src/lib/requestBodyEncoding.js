/**
 * HTTP `Content-Encoding` decoding for inbound JSON request bodies.
 *
 * `Request.json()` does not undo a request's Content-Encoding, so a client
 * that compresses its request would otherwise be told "Invalid JSON body".
 * The chat admission decodes once, before JSON parsing.
 *
 * Only single-value encodings are accepted; a stacked list such as
 * `gzip, deflate` is reported as unsupported. Errors are returned as
 * reasons, never thrown, so no zlib message can leak into a response body.
 * The decompressed output is capped (bomb guard); the cap applies only to
 * the decompressed path — uncompressed bodies keep their existing behavior.
 */

import zlib from "node:zlib";
import { promisify } from "node:util";

function feature(name) {
  // zstd needs Node >= 22.15; feature-detect so older runtimes degrade cleanly.
  const fn = zlib[name];
  return typeof fn === "function" ? promisify(fn) : null;
}

const DECOMPRESSORS = {
  gzip: promisify(zlib.gunzip),
  "x-gzip": promisify(zlib.gunzip),
  br: promisify(zlib.brotliDecompress),
  deflate: promisify(zlib.inflate),
  zstd: feature("zstdDecompress"),
};

/** Cap for decompressed request bodies (bomb guard). */
export const MAX_DECOMPRESSED_BODY_BYTES = 10 * 1024 * 1024;

/** Lower-cased, trimmed encoding token, or `null` for an absent / identity encoding. */
export function normalizeContentEncoding(header) {
  const value = (header ?? "").trim().toLowerCase();
  return value === "" || value === "identity" ? null : value;
}

/**
 * Decode `bytes` per `encoding` (already normalized), expanding to at most `maxOutputLength`.
 * @returns {{ ok: true, body: Uint8Array } | { ok: false, reason: "unsupported" | "too_large" | "invalid" }}
 */
export async function decodeRequestBodyBytes(bytes, encoding, maxOutputLength) {
  const decompress = Object.hasOwn(DECOMPRESSORS, encoding) ? DECOMPRESSORS[encoding] : null;
  if (!decompress) return { ok: false, reason: "unsupported" };
  try {
    const decoded = await decompress(bytes, { maxOutputLength });
    return {
      ok: true,
      body: new Uint8Array(decoded.buffer, decoded.byteOffset, decoded.byteLength),
    };
  } catch (error) {
    const code = error?.code;
    return { ok: false, reason: code === "ERR_BUFFER_TOO_LARGE" ? "too_large" : "invalid" };
  }
}

/**
 * Parse a JSON request body, decoding Content-Encoding first when present.
 * Throws a generic Error on any failure (unsupported encoding, oversize
 * expansion, corrupt compressed data, invalid JSON) — callers map it to
 * their existing "Invalid JSON body" response without leaking zlib detail.
 */
export async function parseJsonRequestBody(request, options = {}) {
  const maxDecompressedBytes = options.maxDecompressedBytes ?? MAX_DECOMPRESSED_BODY_BYTES;
  const encoding = normalizeContentEncoding(request?.headers?.get?.("content-encoding"));
  if (!encoding) {
    return await request.json();
  }
  const bytes = new Uint8Array(await request.arrayBuffer());
  const decoded = await decodeRequestBodyBytes(bytes, encoding, maxDecompressedBytes);
  if (!decoded.ok) {
    throw new Error(`Request body decoding failed: ${decoded.reason}`);
  }
  return JSON.parse(new TextDecoder().decode(decoded.body));
}
