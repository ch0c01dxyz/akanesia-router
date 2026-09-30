// ChatGptWebExecutor — ChatGPT browser-session provider (ported from OmniRoute).
//
// Faithful port of OmniRoute's clean-room ChatGPT Web executor: browser
// storage-state credential validation, prompt building, model → web-UI
// selection mapping, and OpenAI response shaping are all preserved.
//
// Gap: OmniRoute drives the turn through a Playwright browser pool
// (browserPool.ts + chatgptWebBrowserSession.ts + chatgptWebFirstParty.ts +
// chatgptWebTransport.ts + chatgptWebDeltaV1.ts + chatgptWebAttachments.ts),
// which has no 9router equivalent and requires Playwright (not installed in
// 9router). The browser-turn path is therefore stubbed: execute() validates
// everything it can and returns a clear 502 until a browser backend is wired.
// The deps injection seam ({ createSession, runTurn, id, now }) is preserved so
// a Playwright-backed session factory can be plugged in later without touching
// the protocol layer.
import { createHash, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { BaseExecutor } from "./base.js";
import { PROVIDERS } from "../config/providers.js";

const CHATGPT_WEB_PAGE_URL = "https://chatgpt.com/?temporary-chat=true";
const MAX_PROMPT_BYTES = 4 * 1024 * 1024;
const FIRST_PARTY_COOKIE_HOSTS = ["chatgpt.com", "openai.com"];

function baseUrlForProvider() {
  return PROVIDERS["chatgpt-web"]?.baseUrl || "https://chatgpt.com";
}

function statusForAdapterError(message) {
  if (/storage state|credentials|connection ID/i.test(message)) return 401;
  // Preserve upstream quota semantics so the shared account-fallback loop can exclude a
  // depleted Free session and immediately try the next configured ChatGPT Web account.
  if (
    /(?:\bHTTP[_\s-]*429\b|\bstatus\s+429\b|\brate[-_\s]?limit(?:ed)?\b|\bquota\s+(?:exhausted|reached|exceeded)\b|\b(?:image(?:\s+upload)?|upload|usage)\s+limit\s+(?:reached|exceeded)\b|\breached\s+(?:your\s+)?(?:image(?:\s+upload)?|upload|usage)\s+limit\b)/i.test(
      message
    )
  ) {
    return 429;
  }
  if (/request|messages|prompt|model|tools|text content|reasoning effort/i.test(message))
    return 400;
  return 502;
}

function makeExecutorErrorResult(status, message, body, url) {
  const clean = String(message || "").replace(/[\r\n]+/g, " ").slice(0, 2000);
  return {
    response: new Response(
      JSON.stringify({
        error: {
          message: clean,
          type: "upstream_error",
          code: `HTTP_${status}`,
        },
      }),
      {
        status,
        headers: { "Content-Type": "application/json" },
      }
    ),
    url,
    headers: {},
    transformedBody: body,
  };
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFirstPartyHost(value) {
  const host = String(value).toLowerCase().replace(/^\./, "");
  return FIRST_PARTY_COOKIE_HOSTS.some(
    (allowed) => host === allowed || host.endsWith(`.${allowed}`)
  );
}

function validateCookie(value) {
  if (
    !isRecord(value) ||
    typeof value.name !== "string" ||
    !value.name ||
    typeof value.value !== "string" ||
    typeof value.domain !== "string" ||
    typeof value.path !== "string" ||
    !value.path.startsWith("/") ||
    typeof value.expires !== "number" ||
    !Number.isFinite(value.expires) ||
    typeof value.httpOnly !== "boolean" ||
    typeof value.secure !== "boolean" ||
    !["Strict", "Lax", "None"].includes(String(value.sameSite))
  ) {
    throw new Error("ChatGPT Web browser storage state contains an invalid cookie");
  }
  if (!isFirstPartyHost(value.domain)) {
    throw new Error("ChatGPT Web browser storage state contains a foreign cookie domain");
  }
}

function validateOrigin(value) {
  if (!isRecord(value) || typeof value.origin !== "string" || !Array.isArray(value.localStorage)) {
    throw new Error("ChatGPT Web browser storage state contains an invalid origin");
  }
  let url;
  try {
    url = new URL(value.origin);
  } catch {
    throw new Error("ChatGPT Web browser storage state contains an invalid origin");
  }
  if (url.protocol !== "https:" || !isFirstPartyHost(url.hostname)) {
    throw new Error("ChatGPT Web browser storage state contains a foreign origin");
  }
  for (const entry of value.localStorage) {
    if (!isRecord(entry) || typeof entry.name !== "string" || typeof entry.value !== "string") {
      throw new Error("ChatGPT Web browser storage state contains invalid local storage");
    }
  }
}

export function normalizeChatGptWebStorageState(value) {
  if (!isRecord(value) || !Array.isArray(value.cookies) || !Array.isArray(value.origins)) {
    throw new Error("ChatGPT Web browser storage state is invalid");
  }
  for (const cookie of value.cookies) validateCookie(cookie);
  for (const origin of value.origins) validateOrigin(origin);
  return structuredClone(value);
}

/** Pure port of OmniRoute's isChatGptWebAttachmentContentPart. */
function isChatGptWebAttachmentContentPart(value) {
  if (typeof value === "string") return value.toLowerCase().startsWith("data:image/");
  if (!isRecord(value)) return false;
  const type = typeof value.type === "string" ? value.type.toLowerCase() : undefined;
  return ["file", "image", "image_url", "input_file", "input_image"].includes(type);
}

/** Collect attachment refs (upload itself needs the browser backend). */
function findChatGptWebAttachments(messages) {
  const found = [];
  for (const message of messages || []) {
    const content = message?.content;
    if (!Array.isArray(content)) continue;
    for (const part of content) {
      if (isChatGptWebAttachmentContentPart(part)) found.push(part);
    }
  }
  return found;
}

function contentText(value) {
  if (typeof value === "string") return value;
  if (!Array.isArray(value)) {
    throw new Error("ChatGPT Web clean-room adapter supports text content only");
  }
  const parts = [];
  for (const part of value) {
    if (
      isRecord(part) &&
      (part.type === "text" || part.type === "input_text") &&
      typeof part.text === "string"
    ) {
      parts.push(part.text);
      continue;
    }
    if (isChatGptWebAttachmentContentPart(part)) continue;
    throw new Error("ChatGPT Web clean-room adapter received unsupported content");
  }
  return parts.join("");
}

function buildPrompt(body) {
  if (Array.isArray(body.tools) && body.tools.length > 0) {
    throw new Error("ChatGPT Web clean-room adapter does not support tools yet");
  }
  if (!Array.isArray(body.messages) || body.messages.length === 0) {
    throw new Error("ChatGPT Web clean-room adapter requires messages");
  }
  const messages = body.messages.map((value) => {
    if (!isRecord(value) || typeof value.role !== "string") {
      throw new Error("ChatGPT Web clean-room adapter received an invalid message");
    }
    if (!["system", "developer", "user", "assistant"].includes(value.role)) {
      throw new Error("ChatGPT Web clean-room adapter does not support tool messages yet");
    }
    if (Array.isArray(value.tool_calls) && value.tool_calls.length > 0) {
      throw new Error("ChatGPT Web clean-room adapter does not support tools yet");
    }
    return { role: value.role, text: contentText(value.content) };
  });

  const prompt =
    messages.length === 1 && messages[0].role === "user"
      ? messages[0].text
      : messages
          .map(({ role, text }) => `${role[0].toUpperCase()}${role.slice(1)}:\n${text}`)
          .join("\n\n");
  if (!prompt.trim()) throw new Error("ChatGPT Web clean-room adapter requires non-empty text");
  if (new TextEncoder().encode(prompt).byteLength > MAX_PROMPT_BYTES) {
    throw new Error("ChatGPT Web clean-room adapter prompt is too large");
  }
  return prompt;
}

function reasoningEffort(body) {
  if (typeof body.reasoning_effort === "string") return body.reasoning_effort.toLowerCase();
  if (isRecord(body.reasoning) && typeof body.reasoning.effort === "string") {
    return body.reasoning.effort.toLowerCase();
  }
  return null;
}

function effortIndex(effort) {
  if (effort === null || effort === "medium") return 1;
  if (["none", "off", "minimal", "low"].includes(effort)) return 0;
  if (effort === "high") return 2;
  if (effort === "xhigh" || effort === "max") return 3;
  throw new Error(`ChatGPT Web clean-room adapter does not support reasoning effort ${effort}`);
}

function normalizedModel(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/^chatgpt-web\//, "")
    .replace(/^cgpt-web\//, "")
    .replace(/\./g, "-");
}

/** Map the requested model onto the web-UI picker selection. */
function resolveSelection(model, body) {
  const normalized = normalizedModel(model);
  if (normalized === "gpt-5-6-luna-free") {
    return { kind: "free", thinkEnabled: false };
  }
  if (normalized === "gpt-5-6-luna-free-thinking") {
    return { kind: "free", thinkEnabled: true };
  }
  if (normalized === "gpt-5-6-pro") {
    return { kind: "picker", modelLabel: "GPT-5.6 Sol", effortIndex: 4 };
  }
  if (normalized === "gpt-5-6-instant" || normalized === "gpt-5-6") {
    return { kind: "picker", modelLabel: "GPT-5.6 Sol", effortIndex: 0 };
  }
  if (["gpt-5-6-thinking", "gpt-5-6-sol"].includes(normalized)) {
    return {
      kind: "picker",
      modelLabel: "GPT-5.6 Sol",
      effortIndex: effortIndex(reasoningEffort(body)),
    };
  }
  if (normalized === "gpt-5-5-pro") {
    return { kind: "picker", modelLabel: "GPT-5.5", effortIndex: 4 };
  }
  if (normalized === "gpt-5-5-instant") {
    return { kind: "picker", modelLabel: "GPT-5.5", effortIndex: 0 };
  }
  if (["gpt-5-5", "gpt-5-5-thinking"].includes(normalized)) {
    return {
      kind: "picker",
      modelLabel: "GPT-5.5",
      effortIndex: effortIndex(reasoningEffort(body)),
    };
  }
  throw new Error(`ChatGPT Web clean-room adapter received an unsupported model: ${model}`);
}

export function prepareChatGptWebBrowserRequest(model, body) {
  if (!isRecord(body)) throw new Error("ChatGPT Web clean-room adapter requires an object body");
  const prompt = buildPrompt(body);
  const attachments = findChatGptWebAttachments(body.messages);
  return { prompt, selection: resolveSelection(model, body), attachments };
}

function readStorageState(credentials) {
  const providerData = credentials.providerSpecificData;
  const raw = providerData?.storageState ?? credentials.apiKey;
  if (typeof raw === "string") {
    try {
      return normalizeChatGptWebStorageState(JSON.parse(raw));
    } catch (error) {
      if (error instanceof SyntaxError) {
        throw new Error("ChatGPT Web browser storage state JSON is invalid");
      }
      throw error;
    }
  }
  return normalizeChatGptWebStorageState(raw);
}

function optionalString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

export function resolveChatGptWebChromeExecutable(explicit, deps = {}) {
  const env = deps.env ?? process.env;
  const exists = deps.exists ?? existsSync;
  const candidates = [
    explicit,
    env.CHATGPT_WEB_CHROME_PATH,
    env.CHROME_PATH,
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    ...(env.PROGRAMFILES
      ? [join(env.PROGRAMFILES, "Google", "Chrome", "Application", "chrome.exe")]
      : []),
    ...(env["PROGRAMFILES(X86)"]
      ? [join(env["PROGRAMFILES(X86)"], "Google", "Chrome", "Application", "chrome.exe")]
      : []),
    ...(env.LOCALAPPDATA
      ? [join(env.LOCALAPPDATA, "Google", "Chrome", "Application", "chrome.exe")]
      : []),
  ];
  return candidates.find((candidate) =>
    Boolean(candidate?.trim() && exists(candidate.trim()))
  );
}

export function buildChatGptWebOpenAiResponse(model, result, stream, metadata = {}) {
  const id = metadata.id ?? `chatcmpl-${randomUUID()}`;
  const created = metadata.created ?? Math.floor(Date.now() / 1000);
  if (!stream) {
    return Response.json({
      id,
      object: "chat.completion",
      created,
      model,
      choices: [
        {
          index: 0,
          message: { role: "assistant", content: result.text },
          finish_reason: "stop",
        },
      ],
    });
  }

  const chunks = [
    {
      id,
      object: "chat.completion.chunk",
      created,
      model,
      choices: [{ index: 0, delta: { role: "assistant" }, finish_reason: null }],
    },
    {
      id,
      object: "chat.completion.chunk",
      created,
      model,
      choices: [{ index: 0, delta: { content: result.text }, finish_reason: null }],
    },
    {
      id,
      object: "chat.completion.chunk",
      created,
      model,
      choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
    },
  ];
  return new Response(
    chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join("") + "data: [DONE]\n\n",
    { headers: { "Content-Type": "text/event-stream; charset=utf-8" } }
  );
}

/** Default browser-turn path: stubbed — OmniRoute's Playwright browser pool has no 9router equivalent. */
async function unavailableBrowserTurn() {
  throw new Error(
    "ChatGPT Web browser automation is unavailable in this build: it requires a Playwright browser pool (OmniRoute services/browserPool + chatgptWebBrowserSession/first-party driver), which is not installed"
  );
}

/** Common ChatGPT Web executor rebuilt solely from first-party UI/network observations. */
export class ChatGptWebExecutor extends BaseExecutor {
  constructor(deps = {}) {
    super("chatgpt-web", {
      id: "chatgpt-web",
      baseUrl: baseUrlForProvider(),
    });
    this.deps = deps;
  }

  async execute(input) {
    try {
      const prepared = prepareChatGptWebBrowserRequest(input.model, input.body);
      const storageState = readStorageState(input.credentials);
      const connectionId = optionalString(input.credentials.connectionId);
      if (!connectionId) throw new Error("ChatGPT Web clean-room adapter requires a connection ID");
      if (prepared.attachments.length > 0) {
        throw new Error(
          "ChatGPT Web attachments require the browser automation backend, which is unavailable"
        );
      }
      // The storage state is validated above; the digest below preserves the
      // source's per-connection browser-context isolation key derivation.
      const digest = createHash("sha256")
        .update(connectionId)
        .update("\0")
        .update(JSON.stringify(storageState))
        .digest("hex");
      void digest;

      const createSession = this.deps.createSession ?? unavailableBrowserTurn;
      const runTurn = this.deps.runTurn ?? unavailableBrowserTurn;
      const session = await createSession({
        connectionId,
        storageState,
        selection: prepared.selection,
        userAgent: optionalString(input.credentials.providerSpecificData?.customUserAgent),
        locale: optionalString(input.credentials.providerSpecificData?.locale),
        timezone: optionalString(input.credentials.providerSpecificData?.timezone),
        chromeExecutablePath: resolveChatGptWebChromeExecutable(
          optionalString(input.credentials.providerSpecificData?.chromeExecutablePath)
        ),
      });
      const result = await runTurn(session, {
        prompt: prepared.prompt,
        attachments: [],
        signal: input.signal,
      });
      return buildChatGptWebOpenAiResponse(input.model, result, input.stream, {
        id: this.deps.id?.(),
        created: this.deps.now ? Math.floor(this.deps.now() / 1000) : undefined,
      });
    } catch (error) {
      const message = String(error instanceof Error ? error.message : error || "")
        .replace(/[\r\n]+/g, " ")
        .slice(0, 2000);
      return makeExecutorErrorResult(
        statusForAdapterError(message),
        message || "ChatGPT Web browser execution failed",
        input.body,
        baseUrlForProvider()
      );
    }
  }
}

export default ChatGptWebExecutor;
