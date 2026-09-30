/**
 * Arena/AI-SDK SSE line parsing and OpenAI message → Arena prompt formatting.
 * Ported from OmniRoute's executors/lmarena/stream.ts (types stripped).
 */

function parseJsonValue(raw) {
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

function pickString(value, keys) {
  if (typeof value === "string") return value;
  if (!value || typeof value !== "object") return "";
  const data = value;
  for (const key of keys) {
    const candidate = data[key];
    if (typeof candidate === "string") return candidate;
  }
  return JSON.stringify(value);
}

function normalizeArenaSSELine(payload) {
  const participantPrefixed = payload.match(/^[ab]([023dfg]):(.*)$/);
  if (!participantPrefixed) return payload;
  return `${participantPrefixed[1]}:${participantPrefixed[2]}`;
}

export function parseArenaSSE(line) {
  const trimmed = line.trim();
  const payload = trimmed.startsWith("data: ") ? trimmed.substring(6).trim() : trimmed;
  if (!payload) return null;

  // Historical Arena platform errors used `ae:`. Current AI SDK `e:` is
  // finish_step and not terminal, so only treat it as an error when it carries
  // an obvious error payload.
  const legacyError = payload.match(/^[ab]e:(.*)$/);
  if (legacyError) {
    const value = parseJsonValue(legacyError[1] ?? "");
    const content = pickString(value, ["error", "message"]);
    return content ? { type: "error", content } : null;
  }

  const normalized = normalizeArenaSSELine(payload);
  const separator = normalized.indexOf(":");
  if (separator < 0) return null;

  const code = normalized.slice(0, separator);
  const rawValue = normalized.slice(separator + 1);
  const value = parseJsonValue(rawValue);

  switch (code) {
    case "0":
      return { type: "text", content: pickString(value, ["text", "textDelta"]) };
    case "g":
      return { type: "thinking", content: pickString(value, ["thinking", "text", "textDelta"]) };
    case "2":
      return { type: "heartbeat" };
    case "3":
      return { type: "error", content: pickString(value, ["error", "message"]) };
    case "d": {
      if (value && typeof value === "object" && value.finishReason === "error") {
        return { type: "error", content: "Arena stream finished with an error" };
      }
      return { type: "done" };
    }
    default:
      return null;
  }
}

function contentToText(content) {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === "string") return part;
        if (!part || typeof part !== "object") return "";
        const data = part;
        if (typeof data.text === "string") return data.text;
        if (data.type === "image_url") return "[image]";
        return "";
      })
      .filter(Boolean)
      .join("\n");
  }
  if (content && typeof content === "object") {
    const data = content;
    if (typeof data.text === "string") return data.text;
  }
  return content == null ? "" : String(content);
}

export function formatArenaPrompt(messages) {
  const rendered = messages
    .map((message) => {
      const text = contentToText(message.content).trim();
      if (!text) return "";
      const role = typeof message.role === "string" ? message.role : "user";
      const label =
        role === "system"
          ? "System"
          : role === "assistant"
            ? "Assistant"
            : role === "developer"
              ? "Developer"
              : "User";
      return `${label}: ${text}`;
    })
    .filter(Boolean);

  if (rendered.length === 1 && messages[0]?.role === "user") {
    return contentToText(messages[0].content).trim();
  }

  return rendered.join("\n\n");
}
