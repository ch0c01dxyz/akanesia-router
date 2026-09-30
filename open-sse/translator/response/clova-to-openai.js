// Naver CLOVA Studio "Chat Completions v3" → OpenAI response translator.
// Ported from OmniRoute's clova-to-openai translator.
//
// CLOVA v3 streams as SSE with named events:
//   event: token → incremental delta {message:{role,content}, finishReason}
//   event: result → terminal snapshot {message, finishReason, usage} (repeats the
//     COMPLETE text — contributes finish_reason + usage only, never re-emitted)
//
// Traps handled:
// 1. `event: result` repeats the full text → not concatenated.
// 2. Function-calling streams deliver arguments as `partialJson` fragments →
//    reassembled into OpenAI tool_calls[].function.arguments.
// 3. Failures can arrive as in-stream payloads with status.code != "20000" →
//    surfaced via state.upstreamError.
import { register } from "../index.js";
import { FORMATS } from "../formats.js";

// CLOVA's success status code (a string, not an HTTP number).
const CLOVA_STATUS_OK = "20000";

function toRecord(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}

function mapFinishReason(reason) {
  switch (String(reason || "")) {
    case "length":
      return "length";
    case "tool_calls":
      return "tool_calls";
    case "content_filter":
      return "content_filter";
    default:
      return "stop";
  }
}

function httpStatusFromClovaCode(code) {
  const first = String(code || "").charAt(0);
  if (first === "4") return 400;
  return 502;
}

// Parse one raw SSE frame into { event, data }. CLOVA emits id:/event:/data: lines.
export function parseClovaSseFrame(raw) {
  if (typeof raw !== "string" || !raw.trim()) return null;
  let event = "";
  let dataLine = "";
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.startsWith("event:")) {
      event = trimmed.slice(6).trim();
    } else if (trimmed.startsWith("data:")) {
      dataLine = trimmed.slice(5).trim();
    }
  }
  if (!dataLine) return null;
  try {
    return { event, data: JSON.parse(dataLine) };
  } catch {
    return null;
  }
}

function baseChunk(state) {
  return {
    id: state.responseId,
    object: "chat.completion.chunk",
    created: state.created,
    model: state.model || "clova",
  };
}

// Build one OpenAI delta chunk. `field` = "content" or "reasoning_content".
function deltaChunk(state, content, field = "content") {
  const chunk = baseChunk(state);
  chunk.choices = [
    {
      index: 0,
      delta: {
        ...((state.chunkIndex ?? 0) === 0 ? { role: "assistant" } : {}),
        [field]: content,
      },
      finish_reason: null,
    },
  ];
  state.chunkIndex = (state.chunkIndex ?? 0) + 1;
  return chunk;
}

// First tool-call chunk: carries id + name and opens an empty argument string.
function toolCallStartChunk(state, id, name) {
  const chunk = baseChunk(state);
  chunk.choices = [
    {
      index: 0,
      delta: {
        ...((state.chunkIndex ?? 0) === 0 ? { role: "assistant" } : {}),
        tool_calls: [
          { index: 0, id: id || `call_${state.responseId}`, type: "function", function: { name, arguments: "" } },
        ],
      },
      finish_reason: null,
    },
  ];
  state.chunkIndex = (state.chunkIndex ?? 0) + 1;
  return chunk;
}

// Subsequent tool-call chunk: appends one partialJson fragment.
function toolCallArgumentsChunk(state, fragment) {
  const chunk = baseChunk(state);
  chunk.choices = [
    { index: 0, delta: { tool_calls: [{ index: 0, function: { arguments: fragment } }] }, finish_reason: null },
  ];
  state.chunkIndex = (state.chunkIndex ?? 0) + 1;
  return chunk;
}

function terminalChunk(state, finishReason) {
  const chunk = baseChunk(state);
  chunk.choices = [{ index: 0, delta: {}, finish_reason: finishReason }];
  if (state.usage) chunk.usage = state.usage;
  return chunk;
}

function recordUsage(state, usage) {
  const record = toRecord(usage);
  if (!record) return;
  const prompt = Number(record.promptTokens) || 0;
  const completion = Number(record.completionTokens) || 0;
  const total = Number(record.totalTokens) || prompt + completion;
  state.usage = { prompt_tokens: prompt, completion_tokens: completion, total_tokens: total };
}

function recordUpstreamError(state, code, message) {
  const status = httpStatusFromClovaCode(code);
  state.upstreamError = {
    status,
    type: status === 429 ? "rate_limit_error" : "server_error",
    code: String(code || "clova_error"),
    message: typeof message === "string" && message ? message : "CLOVA Studio upstream failure",
  };
}

function initializeState(state) {
  if (state.responseId) return;
  state.responseId = `chatcmpl-${Date.now()}`;
  state.created = Math.floor(Date.now() / 1000);
  state.chunkIndex = 0;
}

function decodeClovaChunk(chunk) {
  if (typeof chunk === "string") {
    const frame = parseClovaSseFrame(chunk);
    const data = toRecord(frame?.data);
    return frame && data ? { event: frame.event, data } : null;
  }
  const data = toRecord(chunk);
  if (!data) return null;
  return { event: String(data.event || data._eventType || ""), data };
}

function handleErrorEnvelope(state, event, data) {
  const status = toRecord(data.status);
  const statusCode = status?.code ?? data.statusCode;
  if (statusCode != null && String(statusCode) !== CLOVA_STATUS_OK) {
    recordUpstreamError(state, statusCode, status?.message ?? data.message);
    return true;
  }
  const error = toRecord(data.error);
  if (event !== "error" && !error) return false;
  const source = error ?? data;
  const errorStatus = toRecord(source.status);
  recordUpstreamError(state, errorStatus?.code ?? source.code, errorStatus?.message ?? source.message);
  return true;
}

function toolCallDelta(state, call) {
  const record = toRecord(call);
  const fn = toRecord(record?.function);
  if (!record || !fn) return null;
  const id = typeof record.id === "string" ? record.id : "";
  const name = typeof fn.name === "string" ? fn.name : "";
  if (id || name) {
    if (state.toolCallStarted) return null;
    state.toolCallStarted = true;
    return toolCallStartChunk(state, id, name);
  }
  return typeof fn.partialJson === "string" && fn.partialJson
    ? toolCallArgumentsChunk(state, fn.partialJson)
    : null;
}

function toolCallDeltas(state, message) {
  if (!Array.isArray(message.toolCalls) || message.toolCalls.length === 0) return null;
  const out = message.toolCalls.map((call) => toolCallDelta(state, call)).filter((c) => c !== null);
  if (out.length === 0) return null;
  return out.length === 1 ? out[0] : out;
}

function convertTokenEvent(state, data) {
  const message = toRecord(data.message) ?? data;
  const toolDeltas = toolCallDeltas(state, message);
  if (toolDeltas) return toolDeltas;
  const thinking = message.thinkingContent ?? data.thinkingContent;
  if (thinking) return deltaChunk(state, String(thinking), "reasoning_content");
  const content = message.content ?? data.content;
  return content ? deltaChunk(state, String(content)) : null;
}

function shouldEmitResultSnapshot(state, isResultEvent, snapshot) {
  return !isResultEvent && (state.chunkIndex ?? 0) === 0 && typeof snapshot === "string" && !!snapshot;
}

function convertResultEvent(state, event, data) {
  const isResultEvent = event === "result" || event === "stop";
  const resultEnvelope = toRecord(data.result);
  if (!isResultEvent && (event || !resultEnvelope)) return null;
  const result = resultEnvelope ?? data;
  const message = toRecord(result.message);
  recordUsage(state, result.usage);
  const hasToolCalls = Array.isArray(message?.toolCalls) && message.toolCalls.length > 0;
  const finishReason = hasToolCalls ? "tool_calls" : mapFinishReason(result.finishReason);
  state.finishReason = finishReason;
  const snapshot = message?.content ?? result.content;
  if (shouldEmitResultSnapshot(state, isResultEvent, snapshot)) {
    return [deltaChunk(state, snapshot), terminalChunk(state, finishReason)];
  }
  return terminalChunk(state, finishReason);
}

// Convert one CLOVA stream frame or JSON envelope into OpenAI chunk(s).
export function convertClovaToOpenAI(chunk, state) {
  if (chunk == null) return null;
  initializeState(state);
  const decoded = decodeClovaChunk(chunk);
  if (!decoded) return null;
  if (handleErrorEnvelope(state, decoded.event, decoded.data)) return null;
  return decoded.event === "token"
    ? convertTokenEvent(state, decoded.data)
    : convertResultEvent(state, decoded.event, decoded.data);
}

register(FORMATS.CLOVA, FORMATS.OPENAI, null, convertClovaToOpenAI);
