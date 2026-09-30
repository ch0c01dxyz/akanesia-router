// Opaque signed-reasoning metadata round-trip through Codex's `encrypted_content` slot.
//
// Ported from OmniRoute's open-sse/vendor/codex-chatgpt-web/responses/reasoning-envelope.ts.
// Adapted from miuuyy/codex-chatgpt-web (MIT).

export const BRIDGE_REASONING_PREFIX = "ocxr1:";

export function encodeReasoningEnvelope(envelope) {
  return (
    BRIDGE_REASONING_PREFIX + Buffer.from(JSON.stringify(envelope), "utf-8").toString("base64")
  );
}

/** Decode an ocxr1 envelope; returns null for native (OpenAI-encrypted) blobs or garbage. */
export function decodeReasoningEnvelope(encryptedContent) {
  if (!encryptedContent.startsWith(BRIDGE_REASONING_PREFIX)) return null;
  try {
    const parsed = JSON.parse(
      Buffer.from(encryptedContent.slice(BRIDGE_REASONING_PREFIX.length), "base64").toString(
        "utf-8"
      )
    );
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    const envelope = {};
    if (typeof parsed.sig === "string") envelope.sig = parsed.sig;
    if (Array.isArray(parsed.red)) {
      const red = parsed.red.filter((r) => typeof r === "string");
      if (red.length > 0) envelope.red = red;
    }
    if (typeof parsed.txt === "string" && parsed.txt.length > 0) envelope.txt = parsed.txt;
    return envelope.sig || envelope.red || envelope.txt ? envelope : null;
  } catch {
    return null;
  }
}
