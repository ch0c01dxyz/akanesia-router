// conol-web-images — image_url resolution for conol-web (ported from OmniRoute's
// cursorImages.ts, browser-upload variant: `prepareForWire: false`).
//
// Turns OpenAI `image_url` parts (base64 `data:` URIs or remote `http(s)` URLs)
// into decoded bytes + mimeType, capped at 1 MiB per image. Remote fetches go
// through a self-contained public-URL guard (OmniRoute uses its canonical
// outboundUrlGuard, which has no 9router equivalent — see the gap note below).
import { randomUUID } from "node:crypto";
import dns from "node:dns";
import { isIP } from "node:net";

/** Upper bound on images attached to one Conol turn. */
export const MAX_CURSOR_IMAGES = 12;

/** Final image cap for browser-upload callers (1 MiB). */
const MAX_CURSOR_IMAGE_BYTES = 1024 * 1024;

/** Inbound decode/fetch bound (16 MiB). */
const MAX_CURSOR_IMAGE_DECODE_BYTES = 16 * 1024 * 1024;

const IMAGE_FETCH_TIMEOUT_MS = 15000;
const MAX_IMAGE_REDIRECTS = 3;

// Known cloud-metadata hostnames the DNS gate cannot catch (single-label /
// internal names that resolve internally).
const METADATA_HOSTNAMES = new Set([
  "metadata.google.internal",
  "metadata.google.com",
  "instance-data",
  "169.254.169.254",
]);

/**
 * A 400-class error carrying a clean, non-sensitive message. The executor
 * catches it and emits a sanitized error response.
 */
export class CursorImageError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.name = "CursorImageError";
    this.status = status;
  }
}

function ipv4ToInt(addr) {
  const parts = addr.split(".").map(Number);
  if (parts.length !== 4 || parts.some((p) => !Number.isInteger(p) || p < 0 || p > 255)) return null;
  return ((parts[0] * 256 + parts[1]) * 256 + parts[2]) * 256 + parts[3];
}

function isPublicIPv4(addr) {
  const n = ipv4ToInt(addr);
  if (n === null) return false;
  const inRange = (base, bits) => {
    const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
    return (n & mask) === (base & mask);
  };
  const ip = (...p) => ((p[0] * 256 + p[1]) * 256 + p[2]) * 256 + p[3];
  // Reject: private, loopback, link-local, multicast, reserved, CGNAT, test nets.
  if (inRange(ip(10, 0, 0, 0), 8)) return false;
  if (inRange(ip(172, 16, 0, 0), 12)) return false;
  if (inRange(ip(192, 168, 0, 0), 16)) return false;
  if (inRange(ip(127, 0, 0, 0), 8)) return false;
  if (inRange(ip(169, 254, 0, 0), 16)) return false;
  if (inRange(ip(224, 0, 0, 0), 4)) return false;
  if (inRange(ip(0, 0, 0, 0), 8)) return false;
  if (inRange(ip(100, 64, 0, 0), 10)) return false;
  if (inRange(ip(192, 0, 2, 0), 24)) return false;
  if (inRange(ip(198, 51, 100, 0), 24)) return false;
  if (inRange(ip(203, 0, 113, 0), 24)) return false;
  if (inRange(ip(192, 88, 99, 0), 24)) return false;
  return true;
}

function isPublicIP(addr) {
  const kind = isIP(addr);
  if (kind === 4) return isPublicIPv4(addr);
  if (kind === 6) {
    const lower = addr.toLowerCase();
    // IPv4-mapped IPv6: judge the embedded IPv4 address.
    const mapped = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isPublicIPv4(mapped[1]);
    // Reject loopback, link-local, unique-local, multicast, unspecified.
    if (lower === "::1" || lower === "::") return false;
    if (lower.startsWith("fe80:") || lower.startsWith("fec0:")) return false;
    if (lower.startsWith("fc") || lower.startsWith("fd")) return false;
    if (lower.startsWith("ff")) return false;
    return true;
  }
  return false;
}

/** Simplified public-URL guard: strict public-only policy for client-supplied image URLs. */
async function validatePublicImageUrl(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new CursorImageError("Image URL is invalid or uses an unsupported scheme.");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new CursorImageError("Image URL is invalid or uses an unsupported scheme.");
  }
  if (parsed.username || parsed.password) {
    throw new CursorImageError("Image URL is invalid or uses an unsupported scheme.");
  }
  const hostname = parsed.hostname.toLowerCase().replace(/\.$/, "");
  if (!hostname || METADATA_HOSTNAMES.has(hostname)) {
    throw new CursorImageError("Image URL points to a blocked address.");
  }
  // Defence-in-depth against DNS-rebinding SSRF: resolve the host and reject
  // if ANY answer is private. (OmniRoute's canonical outboundUrlGuard does
  // more; this narrows but does not fully eliminate the TOCTOU window.)
  const bare = hostname.startsWith("[") && hostname.endsWith("]")
    ? hostname.slice(1, -1)
    : hostname;
  if (isIP(bare)) {
    if (!isPublicIP(bare)) throw new CursorImageError("Image URL points to a blocked address.");
    return parsed;
  }
  let resolved;
  try {
    resolved = await dns.promises.lookup(bare, { all: true });
  } catch {
    throw new CursorImageError("Image URL host could not be resolved.");
  }
  for (const r of resolved) {
    if (!isPublicIP(r.address)) {
      throw new CursorImageError("Image URL points to a blocked address.");
    }
  }
  return parsed;
}

function estimatedBase64DecodedBytes(payload) {
  return Math.floor((payload.length * 3) / 4);
}

function decodeDataUrl(url) {
  // data:[<mediatype>][;base64],<data>
  const comma = url.indexOf(",");
  if (comma < 0) {
    throw new CursorImageError("Image data URL is malformed.");
  }
  const header = url.slice(5, comma); // strip leading "data:"
  const payload = url.slice(comma + 1);
  const isBase64 = /;base64/i.test(header);
  const mimeType = (header.split(";")[0] || "").trim().toLowerCase() || "application/octet-stream";

  if (!mimeType.startsWith("image/")) {
    throw new CursorImageError("Image data URL must have an image/* media type.");
  }
  if (!isBase64) {
    // Non-base64 data URLs (percent-encoded) are not a real image transport;
    // reject rather than guess.
    throw new CursorImageError("Image data URL must be base64-encoded.");
  }

  // Reject on the raw payload length BEFORE the regex/normalize pass, so an
  // arbitrarily large data URL can't burn CPU on the whitespace strip. Base64
  // expands ~4:3, so 2x the decode ceiling is a safe upper bound on the text.
  if (payload.length > MAX_CURSOR_IMAGE_DECODE_BYTES * 2) {
    throw new CursorImageError("Image input is too large to process safely.");
  }

  const normalized = payload.replace(/\s/g, "");
  if (normalized.length === 0) {
    throw new CursorImageError("Image data URL contains invalid base64 data.");
  }
  // Reject lenient Buffer.from acceptances (wrong alphabet, bad padding).
  if (normalized.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(normalized)) {
    throw new CursorImageError("Image data URL contains invalid base64 data.");
  }
  if (estimatedBase64DecodedBytes(normalized) > MAX_CURSOR_IMAGE_DECODE_BYTES) {
    throw new CursorImageError("Image input is too large to process safely.");
  }

  let data;
  try {
    data = Buffer.from(normalized, "base64");
  } catch {
    throw new CursorImageError("Image data URL contains invalid base64 data.");
  }
  if (data.length === 0) {
    throw new CursorImageError("Image data URL contains invalid base64 data.");
  }
  // Round-trip guard: Node can silently drop trailing garbage.
  if (data.toString("base64").replace(/=+$/, "") !== normalized.replace(/=+$/, "")) {
    throw new CursorImageError("Image data URL contains invalid base64 data.");
  }
  if (data.length > MAX_CURSOR_IMAGE_DECODE_BYTES) {
    throw new CursorImageError("Image input is too large to process safely.");
  }
  return { data, mimeType };
}

/** Read a fetch Response body into a Buffer, aborting past `cap`. */
async function readCapped(response, cap) {
  const body = response.body;
  if (!body) return Buffer.alloc(0);
  const chunks = [];
  let total = 0;
  const pushCapped = (chunk) => {
    total += chunk.byteLength;
    if (total > cap) {
      throw new CursorImageError("Image input is too large to process safely.");
    }
    chunks.push(Buffer.from(chunk));
  };
  if (typeof body[Symbol.asyncIterator] === "function") {
    for await (const chunk of body) pushCapped(chunk);
    return Buffer.concat(chunks, total);
  }
  const reader = body.getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      pushCapped(value);
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks, total);
}

async function fetchImageBytes(url) {
  // Follow redirects MANUALLY and re-validate every hop through the guard.
  // `fetch` follows redirects by default, so validating only the initial URL
  // would let a public host 30x-redirect to a private/link-local address and
  // bypass the guard. Each Location is re-checked before we fetch it.
  let currentUrl = url;
  for (let hop = 0; hop <= MAX_IMAGE_REDIRECTS; hop++) {
    const parsed = await validatePublicImageUrl(currentUrl);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), IMAGE_FETCH_TIMEOUT_MS);
    let response;
    try {
      response = await fetch(parsed.toString(), {
        method: "GET",
        signal: controller.signal,
        redirect: "manual",
      });
    } catch {
      clearTimeout(timer);
      throw new CursorImageError("Could not fetch the image URL.");
    }
    try {
      // Manual redirect: resolve Location against the current URL and loop so
      // the next hop is re-validated by the guard.
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get("location");
        if (!location) {
          throw new CursorImageError("Image URL redirect is missing a destination.");
        }
        try {
          currentUrl = new URL(location, parsed.toString()).toString();
        } catch {
          throw new CursorImageError("Image URL redirect destination is invalid.");
        }
        continue;
      }

      if (!response.ok) {
        throw new CursorImageError(`Could not fetch the image URL (status ${response.status}).`);
      }
      const contentType = (response.headers.get("content-type") || "").toLowerCase();
      const mimeType = contentType.split(";")[0].trim();
      if (!mimeType.startsWith("image/")) {
        throw new CursorImageError("Image URL did not return an image content type.");
      }
      // Reject early on an oversized Content-Length, then still cap during read
      // (the header is advisory / may be absent).
      const declaredLen = Number(response.headers.get("content-length") || "0");
      if (Number.isFinite(declaredLen) && declaredLen > MAX_CURSOR_IMAGE_DECODE_BYTES) {
        throw new CursorImageError("Image input is too large to process safely.");
      }
      const data = await readCapped(response, MAX_CURSOR_IMAGE_DECODE_BYTES);
      return { data, mimeType };
    } finally {
      clearTimeout(timer);
    }
  }
  throw new CursorImageError("Image URL has too many redirects.");
}

/**
 * Resolve OpenAI `image_url` URLs (data: or http(s):) into decoded images.
 * Conol uploads the ORIGINAL bytes to the web UI, so no JPEG wire prep:
 * raw data + declared mimeType, capped at 1 MiB.
 * Throws CursorImageError (clean message) on any invalid / oversized / blocked input.
 */
export async function resolveCursorImages(imageUrls, options) {
  const prepareForWire = options?.prepareForWire !== false;
  if (prepareForWire) {
    throw new CursorImageError("Wire-prepared images are not supported by this port.");
  }
  if (imageUrls.length > MAX_CURSOR_IMAGES) {
    throw new CursorImageError(`Too many images in one request (max ${MAX_CURSOR_IMAGES}).`);
  }
  const out = [];
  for (const url of imageUrls) {
    if (typeof url !== "string" || !url) {
      throw new CursorImageError("Image URL is missing.");
    }
    // The data: scheme is case-insensitive (RFC 2397); match it that way but
    // pass the original (un-lowercased) url so the base64 payload is preserved.
    const { data, mimeType } = url.toLowerCase().startsWith("data:")
      ? decodeDataUrl(url)
      : await fetchImageBytes(url);
    if (!data.length) {
      throw new CursorImageError("Image input is empty.");
    }
    if (data.length > MAX_CURSOR_IMAGE_DECODE_BYTES) {
      throw new CursorImageError("Image input is too large to process safely.");
    }
    if (data.length > MAX_CURSOR_IMAGE_BYTES) {
      throw new CursorImageError("Image input is too large (max 1 MiB). Resize and retry.");
    }
    out.push({ data, mimeType, uuid: randomUUID() });
  }
  return out;
}

/**
 * Extract image_url URLs from an OpenAI-shaped message content array.
 * Returns the raw url strings (data: or http(s):) in order. Non-image parts
 * are ignored. A plain string content has no images.
 */
export function extractImageUrls(content) {
  if (!Array.isArray(content)) return [];
  const urls = [];
  for (const part of content) {
    if (part && typeof part === "object" && part.type === "image_url") {
      const imageUrl = part.image_url;
      if (typeof imageUrl === "string") {
        urls.push(imageUrl);
      } else if (
        imageUrl &&
        typeof imageUrl === "object" &&
        typeof imageUrl.url === "string"
      ) {
        urls.push(imageUrl.url);
      }
    }
  }
  return urls;
}
