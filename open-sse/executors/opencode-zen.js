import crypto from "node:crypto";
import { DefaultExecutor } from "./default.js";
import { resolveSessionId } from "../utils/sessionManager.js";
import { applyFingerprintTools } from "../utils/opencodeFingerprint.js";
import {
  normalizeResponsesInput,
  clampResponsesCallId,
  coerceResponsesArguments,
  coerceResponsesOutput,
} from "../translator/formats/responsesApi.js";

const SESSION_HEADER = "x-opencode-session";
const SESSION_FIELD = "_opencodeZenSession";
const MAX_SESSION_LENGTH = 256;

const RESPONSES_BASE_URL = "https://opencode.ai/inference/v1/responses";
const MAX_TOOL_NAME_LEN = 128;
const OPENCODE_UA = "opencode/latest/2.0.29/cli";
export const OPENCODE_SESSION_RE = /^ses_[0-9a-f]{12}[0-9A-Za-z]{14}$/;
const BASE62_CHARS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

function hasValidOpencodeVersion(ua) {
  const s = String(ua || "");
  // v2 format: opencode/latest/<version>/cli
  if (/opencode\/latest\/[\d.]+\/cli/i.test(s)) return true;
  const m = s.match(/opencode\/(\d+)\.(\d+)(?:\.(\d+))?/i);
  if (!m) return false;
  const major = parseInt(m[1], 10);
  const minor = parseInt(m[2], 10);
  return major > 1 || (major === 1 && minor >= 17);
}

function unstableRandom() {
  const bytes = crypto.randomBytes(14);
  let randomPart = "";
  for (let i = 0; i < 14; i++) {
    randomPart += BASE62_CHARS[bytes[i] % 62];
  }
  return randomPart;
}

export function generateSessionId(timestamp = Date.now()) {
  const current = BigInt(timestamp) * 0x1000n + 1n;
  const value = ~current;
  const time = Array.from({ length: 6 }, (_, index) =>
    Number((value >> BigInt(40 - 8 * index)) & 0xffn)
      .toString(16)
      .padStart(2, "0")
  ).join("");
  return `ses_${time}${unstableRandom()}`;
}

export function translateSessionId(sessionId, clientTool = "") {
  if (typeof sessionId === "string" && OPENCODE_SESSION_RE.test(sessionId.trim())) {
    return sessionId.trim();
  }
  const digest = crypto
    .createHash("sha256")
    .update(`opencode\0${clientTool || "generic"}\0${sessionId || ""}`)
    .digest();
  const timeHex = digest.subarray(0, 6).toString("hex");
  let randomPart = "";
  for (let i = 6; i < 20; i++) {
    randomPart += BASE62_CHARS[digest[i] % 62];
  }
  return `ses_${timeHex}${randomPart}`;
}

function toolNameOf(tool) {
  if (!tool || typeof tool !== "object" || Array.isArray(tool)) return "";
  const fn = tool.function && typeof tool.function === "object" && !Array.isArray(tool.function) ? tool.function : null;
  const raw = typeof tool.name === "string" ? tool.name : (typeof fn?.name === "string" ? fn.name : "");
  return raw.trim();
}

function normalizeSession(value) {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  if (!normalized || normalized.length > MAX_SESSION_LENGTH) return null;
  return normalized;
}

function nativeSession(headers) {
  if (!headers || typeof headers !== "object") return null;
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === SESSION_HEADER) {
      const normalized = normalizeSession(value);
      if (normalized && OPENCODE_SESSION_RE.test(normalized)) return normalized;
    }
  }
  return null;
}

function translatedSession(sessionId, clientTool) {
  return translateSessionId(sessionId, clientTool);
}

// Strip the thinking suffix "model(level)" so checks hit the base id.
function baseModelId(model) {
  return String(model || "").replace(/\([^()]+\)\s*$/, "").trim();
}

// Flatten Chat Completions tool declarations into the Responses flat shape and
// drop hosted/nameless tools the /responses endpoint rejects.
function normalizeResponsesTools(body) {
  if (!Array.isArray(body.tools)) return;
  const validNames = new Set();
  body.tools = body.tools.filter((tool) => {
    if (!tool || typeof tool !== "object" || Array.isArray(tool)) return false;
    const fn = tool.function && typeof tool.function === "object" && !Array.isArray(tool.function) ? tool.function : null;
    const rawName = typeof tool.name === "string" ? tool.name : (typeof fn?.name === "string" ? fn.name : "");
    const name = rawName.trim();
    if (!name) return false;
    const description = typeof tool.description === "string" ? tool.description : (typeof fn?.description === "string" ? fn.description : "");
    let parameters = (tool.parameters && typeof tool.parameters === "object" && !Array.isArray(tool.parameters))
      ? tool.parameters
      : (fn?.parameters && typeof fn.parameters === "object" && !Array.isArray(fn.parameters) ? fn.parameters : { type: "object", properties: {} });
    // Mirror the request translator: {type:"object"} without properties is rejected
    // by strict Responses backends, so fill in the empty properties map.
    if (parameters.type === "object" && !parameters.properties) parameters = { ...parameters, properties: {} };
    for (const k of Object.keys(tool)) delete tool[k];
    tool.type = "function";
    tool.name = name.slice(0, MAX_TOOL_NAME_LEN);
    if (description) tool.description = description;
    tool.parameters = parameters;
    validNames.add(tool.name);
    return true;
  });
  if (body.tool_choice && typeof body.tool_choice === "object" && !Array.isArray(body.tool_choice)) {
    if (body.tool_choice.type === "function") {
      const n = typeof body.tool_choice.name === "string" ? body.tool_choice.name.trim() : "";
      if (!n || !validNames.has(n)) delete body.tool_choice;
    }
  }
}

// Last line of defense for native Responses clients (sourceFormat === targetFormat
// skips translation): coerce items in place so malformed tool payloads 400 here
// with a clear shape instead of upstream as InputValidationError.
function sanitizeResponsesItems(body) {
  if (!Array.isArray(body.input)) return;
  body.input = body.input.filter((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return true;
    // Strip prior-turn reasoning items: Muse Spark contributor models route to
    // an upstream Console backend where encrypted_content cannot be validated across
    // rotated accounts or sessions, causing 400 "reasoning encrypted_content was not issued to this caller".
    if (item.type === "reasoning") return false;
    delete item.encrypted_content;
    delete item.reasoning_encrypted_content;
    if (item.type === "function_call") {
      if (!item.name || typeof item.name !== "string" || item.name.trim() === "") return false;
      item.name = item.name.trim().slice(0, MAX_TOOL_NAME_LEN);
      item.call_id = clampResponsesCallId(item.call_id);
      item.arguments = coerceResponsesArguments(item.arguments);
      return true;
    }
    if (item.type === "function_call_output") {
      item.call_id = clampResponsesCallId(item.call_id);
      item.output = coerceResponsesOutput(item.output);
      return true;
    }
    return true;
  });
}

export class OpenCodeZenExecutor extends DefaultExecutor {
  constructor() {
    super("opencode-zen");
  }

  buildUrl(model, stream, urlIndex = 0, credentials = null) {
    // MITM capture: ALL free models go to /responses.
    return RESPONSES_BASE_URL;
  }

  prepareRequestCredentials({ body, credentials, providerSessionId, clientTool } = {}) {
    const sourceCredentials = credentials || {};
    const native = nativeSession(sourceCredentials.rawHeaders);
    const resolved = normalizeSession(providerSessionId) || resolveSessionId({
      headers: sourceCredentials.rawHeaders,
      body,
      connectionId: sourceCredentials.connectionId,
      scope: "opencode-zen",
    });

    const sessionId = native || translatedSession(resolved, clientTool);
    return {
      ...sourceCredentials,
      [SESSION_FIELD]: sessionId,
    };
  }

  async execute(args) {
    const credentials = this.prepareRequestCredentials(args);
    return super.execute({ ...args, credentials });
  }

  buildHeaders(credentials, stream = true, url, model) {
    const headers = super.buildHeaders(credentials || {}, stream, url, model);
    const raw = credentials?.rawHeaders || {};
    const lower = {};
    for (const [k, v] of Object.entries(raw)) lower[k.toLowerCase()] = v;
    const downstreamUa = lower["user-agent"] || "";
    // Free-tier gate: spoof the official client UA (v2 format).
    headers["User-Agent"] = hasValidOpencodeVersion(downstreamUa) ? downstreamUa : OPENCODE_UA;
    headers["x-opencode-client"] = lower["x-opencode-client"] || "cli";

    const prepared = credentials?.[SESSION_FIELD];
    const session = prepared || this.prepareRequestCredentials({ credentials })[SESSION_FIELD];
    // MITM capture: x-opencode-project is a 40-hex hash (SHA-1), not "global".
    const projectHash = session
      ? crypto.createHash("sha1").update(String(session)).digest("hex")
      : "0000000000000000000000000000000000000000";
    headers["x-opencode-project"] = lower["x-opencode-project"] || projectHash;
    // MITM capture: Accept is */*.
    headers["Accept"] = "*/*";

    // v2 gate: mirror the session across four headers; x-opencode-request is
    // rejected with 403 and is no longer sent.
    headers[SESSION_HEADER] = session;
    headers["x-opencode-session-id"] = session;
    headers["x-session-affinity"] = session;
    headers["x-session-id"] = session;
    return headers;
  }

  transformRequest(model, body, stream, credentials) {
    const out = super.transformRequest(model, body);
    // Free-tier gate: upstream 403s stream:false even when everything else is valid.
    if (out && typeof out === "object") out.stream = true;
    // MITM capture (opencode2 v2.0.29): ALL free models go to /responses;
    // the real CLI sends NO tools array. Do NOT inject fingerprint fakes.
    if (out && typeof out === "object") {
      if (out.tool_choice === "none") delete out.tool_choice;
      const normalized = normalizeResponsesInput(out.input);
      if (normalized) out.input = normalized;
      if (!Array.isArray(out.input) || out.input.length === 0) {
        out.input = [{ type: "message", role: "user", content: [{ type: "input_text", text: "..." }] }];
      }
      // Responses names the output cap max_output_tokens, not max_tokens.
      if (out.max_output_tokens === undefined) {
        if (out.max_completion_tokens !== undefined) out.max_output_tokens = out.max_completion_tokens;
        else if (out.max_tokens !== undefined) out.max_output_tokens = out.max_tokens;
      }
      delete out.max_tokens;
      delete out.max_completion_tokens;
      // OpenCode Zen menolak max_output_tokens < 16 (400 invalid_request_error).
      if (typeof out.max_output_tokens === "number") {
        out.max_output_tokens = Math.min(Math.max(out.max_output_tokens, 16), 65536);
      }
      if (out.reasoning_effort !== undefined && out.reasoning === undefined) {
        out.reasoning = { effort: out.reasoning_effort, summary: "auto" };
      }
      if (out.reasoning && typeof out.reasoning === "object" && !Array.isArray(out.reasoning)) {
        if (!out.reasoning.summary) out.reasoning.summary = "auto";
      }
      delete out.reasoning_effort;
      out.stream = true;
      out.store = false;
      const sessionId = credentials?.[SESSION_FIELD];
      if (!out.prompt_cache_key && sessionId) out.prompt_cache_key = sessionId;
      if (!out.include) out.include = ["reasoning.encrypted_content"];
      normalizeResponsesTools(out);
      sanitizeResponsesItems(out);
      // PR #83 (opencode2api): inject genuine tool definitions.
      applyFingerprintTools(out, true);
    }
    return out;
  }
}
