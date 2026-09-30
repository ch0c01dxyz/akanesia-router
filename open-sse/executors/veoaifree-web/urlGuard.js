// urlGuard — self-contained public-URL guard for veoaifree-web.
//
// Replaces OmniRoute's canonical `@/shared/network/outboundUrlGuard`, which
// has no 9router equivalent. Mirrors its surface used by this executor:
// `parseAndValidatePublicUrl` (throws OutboundUrlGuardError with code
// OUTBOUND_URL_INVALID / OUTBOUND_URL_BLOCKED) and `isPrivateHost`.
// Policy is strict public-only for artifact download URLs (the executor then
// requires HTTPS on top).
import { isIP } from "node:net";

export class OutboundUrlGuardError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "OutboundUrlGuardError";
    this.code = code;
  }
}

// Known cloud-metadata hostnames the DNS gate cannot catch (single-label /
// internal names that resolve internally).
const METADATA_HOSTNAMES = new Set([
  "metadata.google.internal",
  "metadata.google.com",
  "instance-data",
  "169.254.169.254",
]);

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

export function isPublicIP(addr) {
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

/** True when `addr` is an IP literal that is NOT publicly routable. */
export function isPrivateHost(addr) {
  return !isPublicIP(addr);
}

/**
 * Parse and syntactically validate an outbound artifact URL.
 * Throws OutboundUrlGuardError(OUTBOUND_URL_INVALID) for malformed input,
 * unsupported scheme, embedded credentials, or blocked hostnames, and
 * OutboundUrlGuardError(OUTBOUND_URL_BLOCKED) for private literal-IP hosts.
 * (DNS resolution of hostnames is done separately by the caller's
 * assertHostnameResolvesPublic, matching the source.)
 */
export function parseAndValidatePublicUrl(input) {
  let parsed;
  try {
    parsed = new URL(String(input || "").trim());
  } catch {
    throw new OutboundUrlGuardError(
      "OUTBOUND_URL_INVALID",
      "Video artifact URL is invalid"
    );
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new OutboundUrlGuardError("OUTBOUND_URL_INVALID", "Video artifact URL is invalid");
  }
  if (parsed.username || parsed.password) {
    throw new OutboundUrlGuardError("OUTBOUND_URL_INVALID", "Video artifact URL is invalid");
  }
  const hostname = parsed.hostname.toLowerCase().replace(/\.$/, "");
  if (!hostname || METADATA_HOSTNAMES.has(hostname)) {
    throw new OutboundUrlGuardError(
      "OUTBOUND_URL_BLOCKED",
      "Video artifact URL is blocked"
    );
  }
  const bare = hostname.startsWith("[") && hostname.endsWith("]")
    ? hostname.slice(1, -1)
    : hostname;
  if (isIP(bare)) {
    if (isPrivateHost(bare)) {
      throw new OutboundUrlGuardError(
        "OUTBOUND_URL_BLOCKED",
        "Video artifact host resolves to a blocked address"
      );
    }
    return parsed;
  }
  return parsed;
}
