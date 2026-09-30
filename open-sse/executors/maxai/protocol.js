/**
 * MaxAI web-app protocol — request bodies, header assembly, and OpenAI→MaxAI
 * context flattening (ported from OmniRoute's executors/maxai/protocol.ts).
 *
 * MaxAI is a stateless-full-history provider: we send the ENTIRE flattened
 * transcript in `message_content[0].text` every turn, always with
 * `chat_history: []`, and mint a fresh `conversation_id` per request.
 */
import { randomUUID } from "node:crypto";

export const MAXAI_BASE_URL = "https://api.maxai.me";
export const MAXAI_CHAT_PATH = "/gpt/cwc/chat";
export const MAXAI_MODELS_CONFIG_PATH = "/models/get_config";

/** Static Firefox-150 identity headers sent on every MaxAI request. */
export function maxaiStaticHeaders() {
  return {
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:150.0) Gecko/20100101 Firefox/150.0",
    Accept: "*/*",
    "Accept-Language": "en-CA,en;q=0.9",
    Origin: "https://www.maxai.co",
    Referer: "https://www.maxai.co/",
    "Sec-Fetch-Dest": "empty",
    "Sec-Fetch-Mode": "cors",
    "Sec-Fetch-Site": "cross-site",
    "Content-Type": "application/json",
  };
}

// ── Chat body ───────────────────────────────────────────────────────────────
// Field ORDER is pinned (it is part of the HTTP/2 request fingerprint).
const CHAT_FIELD_ORDER = [
  "chat_mode",
  "conversation_id",
  "chat_history",
  "message_content",
  "chrome_extension_version",
  "model_name",
  "prompt_id",
  "prompt_name",
  "prompt_inputs",
  "doc_list",
  "event_source",
  "streaming",
  "prompt_type",
  "feature_name",
  "source_type",
  "platform_feature",
];

export function newConversationId() {
  return randomUUID();
}

/**
 * Build the /gpt/cwc/chat body.
 * opts: { conversationId, text, modelName, language?, relatedQuestionCnt?,
 *         appVersion, imageUrls?, docList? }
 *
 * message_content is a typed-parts array: the text part ALWAYS leads (so the
 * flattened transcript stays first and the no-image path is unchanged), then
 * any image_url parts ride alongside.
 */
export function buildMaxaiChatBody(opts) {
  const messageContent = [{ type: "text", text: opts.text }];
  for (const url of opts.imageUrls ?? []) {
    if (typeof url === "string" && url) {
      messageContent.push({ type: "image_url", image_url: { url } });
    }
  }
  const values = {
    chat_mode: "pro_chat",
    conversation_id: opts.conversationId,
    chat_history: [],
    message_content: messageContent,
    chrome_extension_version: opts.appVersion,
    model_name: opts.modelName,
    prompt_id: "chat",
    prompt_name: "chat",
    prompt_inputs: {
      RELATED_QUESTION_CNT: opts.relatedQuestionCnt ?? "5",
      AI_RESPONSE_LANGUAGE: opts.language ?? "English",
    },
    doc_list: opts.docList ?? [],
    event_source: "web",
    streaming: true,
    prompt_type: "freestyle",
    feature_name: "immersive_chat",
    source_type: "NA",
    platform_feature: "web_app",
  };
  const ordered = {};
  for (const k of CHAT_FIELD_ORDER) ordered[k] = values[k];
  return ordered;
}

// ── OpenAI messages[] → MaxAI single text block ──────────────────────────────

const ROLE_LABEL = {
  system: "System",
  user: "User",
  assistant: "Assistant",
};
const HISTORY_HEADER = "=== Conversation so far (for context) ===";
const CURRENT_HEADER = "=== Current request (respond to THIS) ===";

/** Flatten OpenAI `content` (string or multipart array) to text. */
export function contentToText(content) {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) =>
        part && typeof part === "object" && part.type === "text"
          ? String(part.text ?? "")
          : ""
      )
      .filter(Boolean)
      .join("\n");
  }
  return "";
}

/**
 * Extract image_url URLs from the CURRENT (last user) turn of an OpenAI
 * messages[] array. MaxAI is stateless-full-history, so we attach only the
 * current turn's images (history images would be re-sent every request and
 * bloat the body). Returns raw url strings (data: or http(s):) in order.
 */
export function extractCurrentTurnImages(messages) {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]?.role === "user") {
      const content = messages[i]?.content;
      if (!Array.isArray(content)) return [];
      const urls = [];
      for (const part of content) {
        if (part && typeof part === "object" && part.type === "image_url") {
          const imageUrl = part.image_url;
          if (typeof imageUrl === "string" && imageUrl) {
            urls.push(imageUrl);
          } else if (
            imageUrl &&
            typeof imageUrl === "object" &&
            typeof imageUrl.url === "string" &&
            imageUrl.url
          ) {
            urls.push(imageUrl.url);
          }
        }
      }
      return urls;
    }
  }
  return [];
}

/** Render OpenAI tool_calls[] as the prompted `<tool_call>` text MaxAI understands. */
function toolCallsToText(toolCalls) {
  if (!Array.isArray(toolCalls)) return "";
  const blocks = [];
  for (const call of toolCalls) {
    const fn = call?.function;
    if (!fn) continue;
    const name = typeof fn.name === "string" ? fn.name : "";
    let args = fn.arguments;
    if (typeof args !== "string") {
      try {
        args = JSON.stringify(args ?? {});
      } catch {
        args = "{}";
      }
    }
    blocks.push(`<tool_call>${JSON.stringify({ name, arguments: args })}</tool_call>`);
  }
  return blocks.join("\n");
}

/** Render one non-system turn as a labeled block, or null to skip. */
function renderTurn(message) {
  const role = message.role;
  const text = contentToText(message.content).trim();
  if (role === "tool") {
    const id = message.tool_call_id ? ` tool_call_id="${message.tool_call_id}"` : "";
    return `<tool_response${id}>\n${text}\n</tool_response>`;
  }
  if (role === "assistant" && message.tool_calls) {
    const calls = toolCallsToText(message.tool_calls);
    const body = text ? `${text}\n${calls}`.trim() : calls;
    return `Assistant: ${body}`;
  }
  if (!text) return null;
  const label = ROLE_LABEL[role ?? "user"] ?? "User";
  return `${label}: ${text}`;
}

/**
 * Assemble the full structured context into one text block: system text leads,
 * prior turns render as a labeled transcript, and the LAST user turn is fenced
 * under a CURRENT header so a weak model answers THIS turn.
 */
export function assembleMaxaiContext(messages) {
  // Find the last user turn (the current request).
  let curIdx = -1;
  let current = "";
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]?.role === "user") {
      curIdx = i;
      current = contentToText(messages[i].content).trim();
      break;
    }
  }
  const systemParts = [];
  const historyParts = [];
  for (let i = 0; i < messages.length; i++) {
    if (i === curIdx) continue;
    const m = messages[i];
    if (m?.role === "system") {
      const t = contentToText(m.content).trim();
      if (t) systemParts.push(t);
      continue;
    }
    const block = renderTurn(m);
    if (block) historyParts.push(block);
  }
  const out = [...systemParts];
  if (historyParts.length && current) {
    out.push(HISTORY_HEADER + "\n\n" + historyParts.join("\n\n"));
  } else {
    out.push(...historyParts);
  }
  if (current) {
    const head = historyParts.length ? `${CURRENT_HEADER}\n\n` : "";
    out.push(head + current);
  }
  if (out.length === 0) throw new Error("no content to send to MaxAI");
  return out.join("\n\n");
}
