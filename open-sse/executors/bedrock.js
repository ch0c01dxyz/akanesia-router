// BedrockExecutor — Amazon Bedrock via the native Converse / ConverseStream
// REST endpoints (ported from OmniRoute's bedrock executor).
//
// OmniRoute used @aws-sdk/client-bedrock-runtime, which 9router does not
// install. This port signs requests manually (AWS Signature Version 4, via
// node:crypto) and calls the REST endpoints directly:
//
//   POST https://bedrock-runtime.{region}.amazonaws.com/model/{modelId}/converse
//   POST https://bedrock-runtime.{region}.amazonaws.com/model/{modelId}/converse-stream
//
// converse-stream returns an AWS binary event-stream; the parser below
// reconstructs the same event shapes the SDK produced (contentBlockStart,
// contentBlockDelta, messageStop, metadata, *Exception), so the OpenAI→Converse
// message translation (messagesFromOpenAI, tool config, tool-pair
// sanitization) and the stream→OpenAI-SSE translation are faithful ports.
//
// Credentials: AWS access key id / secret access key / optional session token,
// taken from the provider credential's apiKey field
// ("accessKeyId:secretAccessKey" or "accessKeyId:secretAccessKey:sessionToken")
// or from providerSpecificData (awsAccessKeyId/awsSecretAccessKey/
// awsSessionToken, plus accessKeyId/secretAccessKey/sessionToken aliases).
// Region: providerSpecificData.region, then BEDROCK_REGION/AWS_REGION env,
// default us-east-1.
import { createHash, createHmac, randomUUID } from "node:crypto";

import { BaseExecutor } from "./base.js";
import { PROVIDERS } from "../config/providers.js";

const encoder = new TextEncoder();

const BEDROCK_DEFAULT_REGION = "us-east-1";
const BEDROCK_REGION_PATTERN = /^[a-z]{2}(?:-gov)?-[a-z]+-\d+$/i;

function asRecord(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function toText(value) {
  if (typeof value === "string") return value;
  if (value === null || value === undefined) return "";
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function firstString(record, keys) {
  for (const key of keys) {
    const value = record?.[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

// ── Region resolution (ported from OmniRoute open-sse/config/bedrock.ts) ────

function normalizeBedrockRegion(value, fallback = BEDROCK_DEFAULT_REGION) {
  if (typeof value !== "string") return fallback;
  const trimmed = value.trim().toLowerCase();
  return BEDROCK_REGION_PATTERN.test(trimmed) ? trimmed : fallback;
}

function extractBedrockRegionFromBaseUrl(value) {
  if (!value) return null;
  try {
    const hostname = new URL(value).hostname;
    const match = hostname.match(/^bedrock(?:-runtime|-mantle)?\.([a-z0-9-]+)\./i);
    return match?.[1] ? normalizeBedrockRegion(match[1], "") || null : null;
  } catch {
    return null;
  }
}

function resolveBedrockRegion(providerSpecificData) {
  const data = asRecord(providerSpecificData);
  const explicit = normalizeBedrockRegion(data.region, "");
  if (explicit) return explicit;

  const baseUrl = typeof data.baseUrl === "string" ? data.baseUrl : null;
  const fromUrl = extractBedrockRegionFromBaseUrl(baseUrl);
  if (fromUrl) return fromUrl;

  const envRegion =
    (typeof process !== "undefined" &&
      (process.env?.BEDROCK_REGION || process.env?.AWS_REGION)) ||
    "";
  return normalizeBedrockRegion(envRegion, BEDROCK_DEFAULT_REGION);
}

function buildBedrockRuntimeBaseUrl(region) {
  return `https://bedrock-runtime.${normalizeBedrockRegion(region)}.amazonaws.com`;
}

function buildBedrockNativeConverseUrl(region, modelId, stream = false) {
  const encodedModel = encodeURIComponent(modelId);
  return `${buildBedrockRuntimeBaseUrl(region)}/model/${encodedModel}/${stream ? "converse-stream" : "converse"}`;
}

// ── AWS credentials ─────────────────────────────────────────────────────────

function getCustomUserAgent(providerSpecificData) {
  const value = asRecord(providerSpecificData).customUserAgent;
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function resolveAwsCredentials(credentials) {
  const psd = asRecord(credentials?.providerSpecificData);
  let accessKeyId = firstString(psd, [
    "awsAccessKeyId",
    "accessKeyId",
    "aws_access_key_id",
    "AWS_ACCESS_KEY_ID",
  ]);
  let secretAccessKey = firstString(psd, [
    "awsSecretAccessKey",
    "secretAccessKey",
    "aws_secret_access_key",
    "AWS_SECRET_ACCESS_KEY",
  ]);
  let sessionToken = firstString(psd, [
    "awsSessionToken",
    "sessionToken",
    "aws_session_token",
    "AWS_SESSION_TOKEN",
  ]);

  const apiKey =
    typeof credentials?.apiKey === "string" ? credentials.apiKey.trim() : "";
  if ((!accessKeyId || !secretAccessKey) && apiKey) {
    // "accessKeyId:secretAccessKey" or "accessKeyId:secretAccessKey:sessionToken"
    const parts = apiKey.split(":");
    if (parts.length >= 2) {
      if (!accessKeyId) accessKeyId = parts[0].trim();
      if (!secretAccessKey) secretAccessKey = parts[1].trim();
      if (!sessionToken && parts[2]) sessionToken = parts.slice(2).join(":").trim();
    }
  }
  return { accessKeyId, secretAccessKey, sessionToken };
}

// ── AWS Signature Version 4 (node:crypto only) ──────────────────────────────

function hmacSha256(key, data) {
  return createHmac("sha256", key).update(data).digest();
}

function sha256Hex(data) {
  return createHash("sha256").update(data).digest("hex");
}

function amzDateString() {
  // YYYYMMDD'T'HHMMSS'Z'
  return new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

function signBedrockRequest({ url, body, region, accessKeyId, secretAccessKey, sessionToken, userAgent }) {
  const parsed = new URL(url);
  const amzDate = amzDateString();
  const dateStamp = amzDate.slice(0, 8);
  const payloadHash = sha256Hex(body || "");

  const canonicalHeaders = {
    "content-type": "application/json",
    host: parsed.host,
    "x-amz-date": amzDate,
  };
  if (sessionToken) canonicalHeaders["x-amz-security-token"] = sessionToken;

  const signedHeaderNames = Object.keys(canonicalHeaders).sort();
  const canonicalHeadersStr =
    signedHeaderNames.map((name) => `${name}:${canonicalHeaders[name]}\n`).join("") + "\n";

  // Path segments are encoded exactly once — matches buildBedrockNativeConverseUrl.
  const canonicalUri = parsed.pathname
    .split("/")
    .map((segment) => encodeURIComponent(decodeURIComponent(segment)))
    .join("/");
  const canonicalQueryString = "";

  const canonicalRequest = [
    "POST",
    canonicalUri,
    canonicalQueryString,
    canonicalHeadersStr,
    signedHeaderNames.join(";"),
    payloadHash,
  ].join("\n");

  const credentialScope = `${dateStamp}/${region}/bedrock/aws4_request`;
  const stringToSign = ["AWS4-HMAC-SHA256", amzDate, credentialScope, sha256Hex(canonicalRequest)].join(
    "\n"
  );

  const kDate = hmacSha256(`AWS4${secretAccessKey}`, dateStamp);
  const kRegion = hmacSha256(kDate, region);
  const kService = hmacSha256(kRegion, "bedrock");
  const kSigning = hmacSha256(kService, "aws4_request");
  const signature = createHmac("sha256", kSigning).update(stringToSign).digest("hex");

  const headers = {
    "Content-Type": "application/json",
    Host: parsed.host,
    "X-Amz-Date": amzDate,
    Authorization:
      `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${credentialScope}, ` +
      `SignedHeaders=${signedHeaderNames.join(";")}, Signature=${signature}`,
  };
  if (sessionToken) headers["X-Amz-Security-Token"] = sessionToken;
  if (userAgent) headers["User-Agent"] = userAgent;
  return headers;
}

// ── OpenAI → Bedrock Converse translation (faithful port) ────────────────────

function stripDataUrlPrefix(value) {
  if (typeof value !== "string") return null;
  const match = value.match(/^data:image\/(png|jpeg|jpg|gif|webp);base64,(.+)$/i);
  if (!match) return null;
  const format = match[1].toLowerCase() === "jpg" ? "jpeg" : match[1].toLowerCase();
  return { format, data: match[2] };
}

function decodeBase64(value) {
  return Uint8Array.from(Buffer.from(value, "base64"));
}

function normalizeRole(role) {
  if (role === "assistant") return "assistant";
  return "user";
}

function normalizeToolUseId(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function textBlocksFromContent(content, options = {}) {
  if (typeof content === "string") return content.trim() ? [{ text: content }] : [];
  if (!Array.isArray(content)) return [];

  const blocks = [];
  for (const part of content) {
    if (typeof part === "string") {
      if (part.trim()) blocks.push({ text: part });
      continue;
    }
    const p = asRecord(part);
    const type = typeof p.type === "string" ? p.type : "";
    if ((type === "text" || type === "input_text") && typeof p.text === "string") {
      if (p.text.trim()) blocks.push({ text: p.text });
      continue;
    }
    if (type === "image_url" || type === "input_image") {
      const url = typeof p.image_url === "string" ? p.image_url : p.image_url?.url || p.image_url;
      const image = stripDataUrlPrefix(url);
      if (image) {
        blocks.push({
          image: { format: image.format, source: { bytes: decodeBase64(image.data) } },
        });
      }
      continue;
    }
    if (type === "tool_use" && typeof p.id === "string" && typeof p.name === "string") {
      const rawId = normalizeToolUseId(p.id);
      if (rawId && options.skipToolUseIds?.has(rawId)) continue;
      if (rawId && !options.answeredToolUseIds?.has(rawId)) continue;
      blocks.push({
        toolUse: {
          toolUseId: rawId || `toolu_${randomUUID()}`,
          name: p.name,
          input: asRecord(p.input),
        },
      });
      continue;
    }
    if (type === "tool_result" && typeof p.tool_use_id === "string") {
      blocks.push({
        toolResult: {
          toolUseId: p.tool_use_id,
          content: [{ text: toText(p.content) }],
          status: p.is_error ? "error" : "success",
        },
      });
    }
  }

  return blocks;
}

function systemBlocksFromOpenAI(messages) {
  const blocks = [];
  for (const message of messages) {
    const role = message?.role;
    if (role !== "system" && role !== "developer") continue;
    const text = textBlocksFromContent(message.content)
      .map((block) => (typeof block.text === "string" ? block.text : ""))
      .filter(Boolean)
      .join("\n");
    if (text.trim()) blocks.push({ text });
  }
  return blocks;
}

function toolResultContentFromMessage(message) {
  const content = message.content;
  if (typeof content === "string") return [{ text: content || " " }];
  if (Array.isArray(content)) {
    const result = [];
    for (const part of content) {
      if (typeof part === "string") {
        result.push({ text: part || " " });
        continue;
      }
      const p = asRecord(part);
      if (typeof p.text === "string") result.push({ text: p.text || " " });
      else if (p.type === "json" && p.json !== undefined) result.push({ json: p.json });
      else if (p.content !== undefined) result.push({ text: toText(p.content) });
    }
    return result.length > 0 ? result : [{ text: " " }];
  }
  return [{ text: toText(content) || " " }];
}

function collectAnsweredToolUseIds(messages) {
  const answered = new Set();
  for (const message of messages) {
    if (!message || typeof message !== "object") continue;
    if (message.role === "tool") {
      const id = normalizeToolUseId(message.tool_call_id);
      if (id) answered.add(id);
    }
    if (!Array.isArray(message.content)) continue;
    for (const part of message.content) {
      const p = asRecord(part);
      if (p.type !== "tool_result") continue;
      const id = normalizeToolUseId(p.tool_use_id);
      if (id) answered.add(id);
    }
  }
  return answered;
}

function getToolUseIdFromBlock(block) {
  return normalizeToolUseId(block?.toolUse?.toolUseId);
}

function getToolResultIdFromBlock(block) {
  return normalizeToolUseId(block?.toolResult?.toolUseId);
}

function isToolResultOnlyMessage(message) {
  return (
    message?.role === "user" &&
    Array.isArray(message.content) &&
    message.content.length > 0 &&
    message.content.every((block) => Boolean(getToolResultIdFromBlock(block)))
  );
}

function mergeConsecutiveToolResultMessages(messages) {
  const merged = [];
  for (const message of messages) {
    const previous = merged[merged.length - 1];
    if (isToolResultOnlyMessage(previous) && isToolResultOnlyMessage(message)) {
      previous.content.push(...message.content);
      continue;
    }
    merged.push(message);
  }
  return merged;
}

function ensureNonEmptyContent(message) {
  if (!Array.isArray(message.content) || message.content.length === 0) {
    message.content = [{ text: " " }];
  }
}

function sanitizeBedrockToolPairs(messages) {
  const normalized = mergeConsecutiveToolResultMessages(messages);
  const validResultCounts = new Map();

  for (let i = 0; i < normalized.length; i++) {
    const message = normalized[i];
    if (message?.role !== "assistant" || !Array.isArray(message.content)) continue;

    const nextMessage = normalized[i + 1];
    const nextResultIds = new Set(
      nextMessage?.role === "user" && Array.isArray(nextMessage.content)
        ? nextMessage.content.map(getToolResultIdFromBlock).filter(Boolean)
        : []
    );

    const toolUseIds = message.content.map(getToolUseIdFromBlock).filter(Boolean);
    if (toolUseIds.length === 0) continue;

    const allowedIds = new Set(toolUseIds.filter((id) => nextResultIds.has(id)));
    message.content = message.content.filter((block) => {
      const toolUseId = getToolUseIdFromBlock(block);
      return !toolUseId || allowedIds.has(toolUseId);
    });
    ensureNonEmptyContent(message);
    for (const id of allowedIds) {
      validResultCounts.set(id, (validResultCounts.get(id) || 0) + 1);
    }
  }

  for (const message of normalized) {
    if (message?.role !== "user" || !Array.isArray(message.content)) continue;
    message.content = message.content.filter((block) => {
      const resultId = getToolResultIdFromBlock(block);
      if (!resultId) return true;
      const remaining = validResultCounts.get(resultId) || 0;
      if (remaining <= 0) return false;
      validResultCounts.set(resultId, remaining - 1);
      return true;
    });
    ensureNonEmptyContent(message);
  }

  return normalized;
}

function messagesFromOpenAI(messages) {
  const converted = [];
  const pendingToolUseIds = new Set();
  const answeredToolUseIds = collectAnsweredToolUseIds(messages);

  for (const message of messages) {
    if (!message || typeof message !== "object") continue;
    if (message.role === "system" || message.role === "developer") continue;

    if (message.role === "tool") {
      const toolUseId = normalizeToolUseId(message.tool_call_id) || `toolu_${randomUUID()}`;
      pendingToolUseIds.delete(toolUseId);
      answeredToolUseIds.add(toolUseId);
      converted.push({
        role: "user",
        content: [
          {
            toolResult: {
              toolUseId,
              content: toolResultContentFromMessage(message),
              status: "success",
            },
          },
        ],
      });
      continue;
    }

    const toolCalls = Array.isArray(message.tool_calls) ? message.tool_calls : [];
    const toolCallIds = new Set(
      toolCalls.map((call) => normalizeToolUseId(call?.id)).filter(Boolean)
    );
    const content = textBlocksFromContent(message.content, {
      skipToolUseIds: toolCallIds,
      answeredToolUseIds,
    });
    for (const call of toolCalls) {
      const fn = asRecord(call.function);
      const rawArgs = typeof fn.arguments === "string" ? fn.arguments : "{}";
      let input = {};
      try {
        input = rawArgs.trim() ? JSON.parse(rawArgs) : {};
      } catch {
        input = { arguments: rawArgs };
      }
      const toolUseId = normalizeToolUseId(call.id) || `toolu_${randomUUID()}`;
      if (pendingToolUseIds.has(toolUseId)) continue;
      if (!answeredToolUseIds.has(toolUseId)) continue;
      pendingToolUseIds.add(toolUseId);
      content.push({
        toolUse: {
          toolUseId,
          name: typeof fn.name === "string" && fn.name ? fn.name : "unknown_tool",
          input,
        },
      });
    }

    if (content.length === 0) {
      content.push({ text: " " });
    }

    converted.push({ role: normalizeRole(message.role), content });
  }

  if (converted.length === 0) {
    converted.push({ role: "user", content: [{ text: " " }] });
  }

  return sanitizeBedrockToolPairs(converted);
}

function toolConfigFromOpenAI(tools, toolChoice) {
  if (!Array.isArray(tools) || tools.length === 0) return undefined;
  const bedrockTools = [];
  for (const tool of tools) {
    const t = asRecord(tool);
    const fn = t.type === "function" ? asRecord(t.function) : t;
    const name = typeof fn.name === "string" ? fn.name.trim() : "";
    if (!name) continue;
    bedrockTools.push({
      toolSpec: {
        name,
        description: typeof fn.description === "string" ? fn.description : undefined,
        inputSchema: { json: asRecord(fn.parameters) },
      },
    });
  }
  if (bedrockTools.length === 0) return undefined;

  const config = { tools: bedrockTools };
  if (toolChoice === "required") config.toolChoice = { any: {} };
  else if (toolChoice === "auto") config.toolChoice = { auto: {} };
  else if (toolChoice && typeof toolChoice === "object") {
    const fn = asRecord(toolChoice.function);
    const name = typeof fn.name === "string" ? fn.name : "";
    if (name) config.toolChoice = { tool: { name } };
  }
  return config;
}

export function openAIToBedrockConverse(model, body) {
  const request = asRecord(body);
  const messages = Array.isArray(request.messages) ? request.messages : [];
  const inferenceConfig = {};

  const maxTokens = request.max_tokens ?? request.max_completion_tokens;
  if (typeof maxTokens === "number") inferenceConfig.maxTokens = Math.max(1, Math.floor(maxTokens));
  if (typeof request.temperature === "number") inferenceConfig.temperature = request.temperature;
  if (typeof request.top_p === "number") inferenceConfig.topP = request.top_p;
  if (Array.isArray(request.stop)) inferenceConfig.stopSequences = request.stop.filter(Boolean);
  else if (typeof request.stop === "string" && request.stop)
    inferenceConfig.stopSequences = [request.stop];

  const payload = {
    modelId: model,
    messages: messagesFromOpenAI(messages),
  };

  const system = systemBlocksFromOpenAI(messages);
  if (system.length > 0) payload.system = system;
  if (Object.keys(inferenceConfig).length > 0) payload.inferenceConfig = inferenceConfig;

  const toolConfig = toolConfigFromOpenAI(request.tools, request.tool_choice);
  if (toolConfig) payload.toolConfig = toolConfig;

  if (request.additionalModelRequestFields !== undefined) {
    payload.additionalModelRequestFields = request.additionalModelRequestFields;
  }

  return payload;
}

/**
 * The AWS SDK serialized binary payloads (image bytes) to base64 automatically.
 * Over REST the payload is plain JSON, so convert any Uint8Array to base64
 * before stringifying.
 */
function serializeForRest(value) {
  if (value instanceof Uint8Array) {
    return Buffer.from(value).toString("base64");
  }
  if (Array.isArray(value)) return value.map(serializeForRest);
  if (value && typeof value === "object") {
    const out = {};
    for (const [key, item] of Object.entries(value)) {
      if (item !== undefined) out[key] = serializeForRest(item);
    }
    return out;
  }
  return value;
}

// ── Converse → OpenAI translation (faithful port) ───────────────────────────

function convertStopReason(reason) {
  switch (reason) {
    case "tool_use":
      return "tool_calls";
    case "max_tokens":
      return "length";
    case "stop_sequence":
    case "end_turn":
    default:
      return "stop";
  }
}

function usageFromBedrock(usage) {
  const input = Number(usage?.inputTokens || 0);
  const output = Number(usage?.outputTokens || 0);
  return {
    prompt_tokens: input,
    completion_tokens: output,
    total_tokens: Number(usage?.totalTokens || input + output),
    cache_read_input_tokens: Number(usage?.cacheReadInputTokenCount || 0),
    cache_creation_input_tokens: Number(usage?.cacheWriteInputTokenCount || 0),
  };
}

function contentBlocksToOpenAIMessage(blocks) {
  const text = [];
  const reasoning = [];
  const toolCalls = [];
  for (const block of Array.isArray(blocks) ? blocks : []) {
    if (typeof block?.text === "string") text.push(block.text);
    if (typeof block?.reasoningContent?.reasoningText?.text === "string") {
      reasoning.push(block.reasoningContent.reasoningText.text);
    }
    if (block?.toolUse) {
      toolCalls.push({
        id: block.toolUse.toolUseId,
        type: "function",
        function: {
          name: block.toolUse.name,
          arguments: JSON.stringify(block.toolUse.input || {}),
        },
      });
    }
  }

  const message = { role: "assistant", content: text.join("") };
  if (reasoning.length > 0) message.reasoning_content = reasoning.join("");
  if (toolCalls.length > 0) {
    message.content = message.content || null;
    message.tool_calls = toolCalls;
  }
  return message;
}

function openAICompletionFromConverse(output, model) {
  const message = contentBlocksToOpenAIMessage(output?.output?.message?.content || []);
  return {
    id: `chatcmpl-bedrock-${randomUUID()}`,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [
      {
        index: 0,
        message,
        finish_reason: convertStopReason(output?.stopReason),
      },
    ],
    usage: usageFromBedrock(output?.usage),
  };
}

function sse(data) {
  return encoder.encode(`data: ${JSON.stringify(data)}\n\n`);
}

function done() {
  return encoder.encode("data: [DONE]\n\n");
}

function openAIChunk(model, delta, finishReason = null, usage = undefined) {
  const chunk = {
    id: `chatcmpl-bedrock-${model}`,
    object: "chat.completion.chunk",
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [{ index: 0, delta, finish_reason: finishReason }],
  };
  if (usage) chunk.usage = usage;
  return chunk;
}

function statusFromHttpStatus(status) {
  return Number.isInteger(status) && status >= 400 && status <= 599 ? status : 502;
}

function errorBodyFromHttp(status, message, code) {
  return {
    error: {
      message: message || "Bedrock request failed",
      type:
        status === 429
          ? "rate_limit_error"
          : status === 401 || status === 403
            ? "auth_error"
            : "upstream_error",
      code: code || `HTTP_${status}`,
      status,
    },
  };
}

function streamExceptionPayload(event) {
  const candidates = [
    event?.throttlingException,
    event?.validationException,
    event?.modelStreamErrorException,
    event?.serviceUnavailableException,
    event?.internalServerException,
  ].filter(Boolean);
  return candidates[0] || null;
}

function statusFromStreamException(exception) {
  const name = String(exception?.name || exception?.code || "");
  if (name.includes("Throttling")) return 429;
  if (name.includes("Validation")) return 400;
  if (name.includes("ServiceUnavailable")) return 503;
  if (name.includes("InternalServer")) return 500;
  return 502;
}

// ── AWS event-stream (binary) parser ─────────────────────────────────────────
// converse-stream returns application/vnd.amazon.eventstream. Each message:
//   [totalLen u32be][headersLen u32be][preludeCRC u32be][headers][payload][messageCRC u32be]
// The payload is JSON whose keys match the SDK's event shapes, so the code
// below feeds the same shapes into the faithful-port stream translator.

const CRC32_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes) {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    crc = CRC32_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

const textDecoder = new TextDecoder();

function readHeaderValue(view, offset, type) {
  switch (type) {
    case 0:
      return { value: true, next: offset };
    case 1:
      return { value: false, next: offset };
    case 2:
      return { value: view.getUint8(offset), next: offset + 1 };
    case 3:
      return { value: view.getUint16(offset), next: offset + 2 };
    case 4:
      return { value: view.getUint32(offset), next: offset + 4 };
    case 5:
      return { value: Number(view.getBigUint64(offset)), next: offset + 8 };
    case 6:
    case 7: {
      const length = view.getUint16(offset);
      const start = offset + 2;
      const bytes = new Uint8Array(view.buffer, view.byteOffset + start, length);
      return {
        value: type === 7 ? textDecoder.decode(bytes) : bytes,
        next: start + length,
      };
    }
    case 8:
      return { value: Number(view.getBigUint64(offset)), next: offset + 8 };
    case 9: {
      const bytes = new Uint8Array(view.buffer, view.byteOffset + offset, 16);
      const hex = [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
      return {
        value: `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`,
        next: offset + 16,
      };
    }
    default:
      throw new Error(`Unsupported event-stream header value type ${type}`);
  }
}

function parseEventStreamMessage(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const totalLength = view.getUint32(0);
  const headersLength = view.getUint32(4);
  const prelude = new Uint8Array(bytes.buffer, bytes.byteOffset, 8);
  if (view.getUint32(8) !== crc32(prelude)) {
    throw new Error("Bedrock event-stream prelude CRC mismatch");
  }
  const messageBytes = new Uint8Array(bytes.buffer, bytes.byteOffset, totalLength);
  if (view.getUint32(totalLength - 4) !== crc32(messageBytes.subarray(0, totalLength - 4))) {
    throw new Error("Bedrock event-stream message CRC mismatch");
  }

  const headers = {};
  let offset = 12;
  const headersEnd = 12 + headersLength;
  while (offset < headersEnd) {
    const nameLength = view.getUint8(offset);
    offset += 1;
    const nameBytes = new Uint8Array(view.buffer, view.byteOffset + offset, nameLength);
    const name = textDecoder.decode(nameBytes);
    offset += nameLength;
    const valueType = view.getUint8(offset);
    offset += 1;
    const { value, next } = readHeaderValue(view, offset, valueType);
    offset = next;
    headers[name] = value;
  }

  const payloadStart = headersEnd;
  const payloadEnd = totalLength - 4;
  const payloadBytes = new Uint8Array(
    view.buffer,
    view.byteOffset + payloadStart,
    payloadEnd - payloadStart
  );
  return { headers, payloadBytes };
}

function lowerFirst(value) {
  return value ? value.charAt(0).toLowerCase() + value.slice(1) : value;
}

/** Parse one event-stream message into the SDK-shaped event object. */
function eventFromMessage({ headers, payloadBytes }) {
  const messageType = headers[":message-type"];
  if (messageType === "exception") {
    const rawType = String(headers[":exception-type"] || "InternalServerException");
    const shapeName = rawType.includes("#") ? rawType.slice(rawType.indexOf("#") + 1) : rawType;
    let payload = {};
    try {
      payload = JSON.parse(textDecoder.decode(payloadBytes));
    } catch {
      // keep empty
    }
    const key = lowerFirst(shapeName.replace(/Exception$/, "") + "Exception") || "internalServerException";
    return {
      [key]: {
        name: shapeName,
        message: typeof payload.message === "string" ? payload.message : "Bedrock stream failed",
      },
    };
  }
  if (messageType !== "event") return null;
  try {
    return JSON.parse(textDecoder.decode(payloadBytes));
  } catch {
    return null;
  }
}

/** Async generator of parsed events from a converse-stream response body. */
async function* parseBedrockEventStream(body) {
  if (!body) return;
  const reader = body.getReader();
  let buffer = new Uint8Array(0);
  try {
    while (true) {
      const { done: streamDone, value } = await reader.read();
      if (streamDone) break;
      const next = new Uint8Array(buffer.length + value.length);
      next.set(buffer);
      next.set(value, buffer.length);
      buffer = next;

      while (buffer.length >= 12) {
        const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
        const totalLength = view.getUint32(0);
        if (totalLength < 16 || buffer.length < totalLength) break;
        const messageBytes = buffer.subarray(0, totalLength);
        buffer = buffer.subarray(totalLength);
        const event = eventFromMessage(parseEventStreamMessage(messageBytes));
        if (event) yield event;
      }
    }
  } finally {
    reader.releaseLock();
  }
}

function createOpenAIStreamFromBedrock(eventIterable, model) {
  const blockToolIndexes = new Map();
  let nextToolIndex = 0;
  let finishReason = "stop";
  let finalUsage = null;

  return new ReadableStream({
    async start(controller) {
      try {
        controller.enqueue(sse(openAIChunk(model, { role: "assistant" })));
        for await (const event of eventIterable) {
          const exception = streamExceptionPayload(event);
          if (exception) {
            const status = statusFromStreamException(exception);
            controller.enqueue(
              sse({
                error: {
                  message: exception.message || "Bedrock stream failed",
                  type: status === 429 ? "rate_limit_error" : "upstream_error",
                  code: exception.name || "bedrock_stream_error",
                  status,
                },
              })
            );
            break;
          }

          if (event.contentBlockStart?.start?.toolUse) {
            const tool = event.contentBlockStart.start.toolUse;
            const index = nextToolIndex++;
            blockToolIndexes.set(event.contentBlockStart.contentBlockIndex, index);
            controller.enqueue(
              sse(
                openAIChunk(model, {
                  tool_calls: [
                    {
                      index,
                      id: tool.toolUseId,
                      type: "function",
                      function: { name: tool.name, arguments: "" },
                    },
                  ],
                })
              )
            );
            continue;
          }

          if (event.contentBlockDelta?.delta) {
            const delta = event.contentBlockDelta.delta;
            if (typeof delta.text === "string" && delta.text.length > 0) {
              controller.enqueue(sse(openAIChunk(model, { content: delta.text })));
            }
            if (typeof delta.reasoningContent?.text === "string" && delta.reasoningContent.text) {
              controller.enqueue(
                sse(openAIChunk(model, { reasoning_content: delta.reasoningContent.text }))
              );
            }
            if (typeof delta.toolUse?.input === "string") {
              const index = blockToolIndexes.get(event.contentBlockDelta.contentBlockIndex) ?? 0;
              controller.enqueue(
                sse(
                  openAIChunk(model, {
                    tool_calls: [{ index, function: { arguments: delta.toolUse.input } }],
                  })
                )
              );
            }
            continue;
          }

          if (event.messageStop?.stopReason) {
            finishReason = convertStopReason(event.messageStop.stopReason);
            continue;
          }

          if (event.metadata?.usage) {
            finalUsage = usageFromBedrock(event.metadata.usage);
          }
        }

        controller.enqueue(sse(openAIChunk(model, {}, finishReason, finalUsage || undefined)));
        controller.enqueue(done());
        controller.close();
      } catch (error) {
        const status = statusFromHttpStatus(Number(error?.status));
        const body = errorBodyFromHttp(
          status,
          error instanceof Error ? error.message : "Bedrock request failed"
        );
        controller.enqueue(sse(body));
        controller.enqueue(done());
        controller.close();
      }
    },
  });
}

// ── Executor ──────────────────────────────────────────────────────────────────

export class BedrockExecutor extends BaseExecutor {
  constructor() {
    super("bedrock", PROVIDERS.bedrock || { format: "openai" });
  }

  buildUrl(model, stream, _urlIndex = 0, credentials = null) {
    return buildBedrockNativeConverseUrl(
      resolveBedrockRegion(credentials?.providerSpecificData),
      model,
      stream
    );
  }

  buildHeaders(credentials) {
    // The real Authorization header is SigV4-signed per request in execute();
    // this placeholder keeps header logging from leaking key material.
    return {
      "Content-Type": "application/json",
      Authorization: credentials?.apiKey ? "Bearer ***" : "",
    };
  }

  async execute({ model, body, stream, credentials, signal, log }) {
    const region = resolveBedrockRegion(credentials?.providerSpecificData);
    const url = this.buildUrl(model, stream, 0, credentials);
    const headers = this.buildHeaders(credentials);

    const { accessKeyId, secretAccessKey, sessionToken } = resolveAwsCredentials(credentials);
    if (!accessKeyId || !secretAccessKey) {
      return {
        response: new Response(
          JSON.stringify(
            errorBodyFromHttp(
              401,
              "Missing Bedrock credentials — provide AWS accessKeyId:secretAccessKey as the API key, or awsAccessKeyId/awsSecretAccessKey in the provider's specific data",
              "MissingCredentials"
            )
          ),
          { status: 401, headers: { "Content-Type": "application/json" } }
        ),
        url,
        headers,
        transformedBody: null,
      };
    }

    const cleanedBody = this.transformRequest(model, body, stream, credentials);
    const transformedBody = serializeForRest(openAIToBedrockConverse(model, cleanedBody));
    const bodyStr = JSON.stringify(transformedBody);
    const signedHeaders = signBedrockRequest({
      url,
      body: bodyStr,
      region,
      accessKeyId,
      secretAccessKey,
      sessionToken,
      userAgent: getCustomUserAgent(credentials?.providerSpecificData),
    });

    log?.info?.("BEDROCK", `POST ${url} | region=${region} model=${model} stream=${!!stream}`);

    let upstream;
    try {
      upstream = await fetch(url, {
        method: "POST",
        headers: signedHeaders,
        body: bodyStr,
        signal: signal ?? undefined,
      });
    } catch (error) {
      const status = error?.name === "AbortError" ? 504 : 502;
      return {
        response: new Response(
          JSON.stringify(
            errorBodyFromHttp(
              status,
              `Bedrock request failed: ${error instanceof Error ? error.message : String(error)}`
            )
          ),
          { status, headers: { "Content-Type": "application/json" } }
        ),
        url,
        headers: signedHeaders,
        transformedBody,
      };
    }

    if (!upstream.ok) {
      let message = `Bedrock request failed with HTTP ${upstream.status}`;
      let code = `HTTP_${upstream.status}`;
      try {
        const errJson = await upstream.json();
        if (typeof errJson?.message === "string" && errJson.message) message = errJson.message;
        if (typeof errJson?.__type === "string" && errJson.__type) {
          code = errJson.__type.includes("#")
            ? errJson.__type.slice(errJson.__type.indexOf("#") + 1)
            : errJson.__type;
        }
      } catch {
        // keep defaults
      }
      const status = statusFromHttpStatus(upstream.status);
      return {
        response: new Response(JSON.stringify(errorBodyFromHttp(status, message, code)), {
          status,
          headers: { "Content-Type": "application/json" },
        }),
        url,
        headers: signedHeaders,
        transformedBody,
      };
    }

    if (stream) {
      return {
        response: new Response(createOpenAIStreamFromBedrock(parseBedrockEventStream(upstream.body), model), {
          status: 200,
          headers: { "Content-Type": "text/event-stream" },
        }),
        url,
        headers: signedHeaders,
        transformedBody,
      };
    }

    try {
      const output = await upstream.json();
      return {
        response: new Response(JSON.stringify(openAICompletionFromConverse(output, model)), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
        url,
        headers: signedHeaders,
        transformedBody,
      };
    } catch (error) {
      return {
        response: new Response(
          JSON.stringify(
            errorBodyFromHttp(
              502,
              `Bedrock response parse failed: ${error instanceof Error ? error.message : String(error)}`
            )
          ),
          { status: 502, headers: { "Content-Type": "application/json" } }
        ),
        url,
        headers: signedHeaders,
        transformedBody,
      };
    }
  }
}

export default BedrockExecutor;
