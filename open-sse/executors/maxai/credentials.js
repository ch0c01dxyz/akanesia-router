/**
 * MaxAI connection credential resolution (ported from OmniRoute's
 * executors/maxai/credentials.ts).
 *
 * MaxAI's request signer needs three things bound together: the OpenAI-style
 * `access_token` (Bearer, ~24h), the `device_id` that minted it (embedded in the
 * signed `X-Authorization` — a mismatch is rejected), and the `user_id` (folded
 * into the signature proof). These are stored in the connection's
 * `providerSpecificData` (minted by the browser-mint flow); this module only
 * READS the stored credential.
 */

function firstString(...values) {
  for (const v of values) {
    if (typeof v === "string") {
      // Raw browser LocalStorage sometimes wraps the device id in quotes.
      const trimmed = v.trim().replace(/^"|"$/g, "");
      if (trimmed.length > 0) return trimmed;
    }
  }
  return null;
}

/** Decode the `user_id` from a MaxAI access JWT (subject.user_id or sub). No verify. */
export function userIdFromJwt(accessToken) {
  try {
    const seg = accessToken.split(".")[1];
    if (!seg) return null;
    const b64 = seg.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (seg.length % 4)) % 4);
    const claims = JSON.parse(Buffer.from(b64, "base64").toString("utf8"));
    const subject = claims?.subject;
    if (typeof subject?.user_id === "string") return subject.user_id;
    if (typeof claims?.sub === "string") return claims.sub;
    return null;
  } catch {
    return null;
  }
}

/** Epoch seconds of the access-JWT `exp`, or 0 when undecodable. */
export function accessTokenExpiry(accessToken) {
  try {
    const seg = accessToken.split(".")[1];
    if (!seg) return 0;
    const b64 = seg.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (seg.length % 4)) % 4);
    const claims = JSON.parse(Buffer.from(b64, "base64").toString("utf8"));
    return typeof claims?.exp === "number" ? claims.exp : 0;
  } catch {
    return 0;
  }
}

/**
 * Resolve the MaxAI credential from a connection's providerSpecificData (with the
 * OpenAI-style `access_token` optionally supplied separately by the caller).
 * Returns null when not fully configured (all three of accessToken/deviceId/userId required).
 */
export function resolveMaxaiCredential(psd, accessTokenFromConnection) {
  const accessToken = firstString(
    accessTokenFromConnection,
    psd?.maxaiAccessToken,
    psd?.accessToken
  );
  if (!accessToken) return null;

  const deviceId = firstString(psd?.maxaiDeviceId, psd?.deviceId);
  if (!deviceId) return null;

  const userId =
    firstString(psd?.maxaiUserId, psd?.userId) ?? userIdFromJwt(accessToken);
  if (!userId) return null;

  const refreshToken =
    firstString(psd?.maxaiRefreshToken, psd?.refreshToken) ?? undefined;

  return { accessToken, deviceId, userId, refreshToken };
}
