// MoonshotExecutor — ported from OmniRoute's moonshot executor.
// Moonshot/Kimi (api.moonshot.ai) is OpenAI-compatible but Kimi models reject
// fixed sampling params and need thinking/reasoning normalization.
import { DefaultExecutor } from "./default.js";

const FIXED_SAMPLING_PARAMS = ["temperature", "top_p", "frequency_penalty", "presence_penalty", "n"];

function isPlainObject(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

// Local port of OmniRoute's flattenOpenAIToolRootAnyOf: strip root-level
// anyOf from tool parameter schemas (Moonshot rejects them).
function flattenOpenAIToolRootAnyOf(tools) {
  if (!Array.isArray(tools)) return tools;
  return tools.map((tool) => {
    if (!isPlainObject(tool)) return tool;
    const next = { ...tool };
    const fn = isPlainObject(next.function) ? { ...next.function } : next;
    if (!isPlainObject(fn.parameters) || !("anyOf" in fn.parameters)) return tool;
    const parameters = { ...fn.parameters };
    delete parameters.anyOf;
    fn.parameters = parameters;
    if (fn !== next) next.function = fn;
    return next;
  });
}

function asRecord(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}

function normalizeMaxCompletionTokens(body, ceiling) {
  if (body.max_completion_tokens === undefined && body.max_tokens !== undefined) {
    body.max_completion_tokens = body.max_tokens;
  }
  delete body.max_tokens;
  if (
    typeof body.max_completion_tokens === "number" &&
    Number.isFinite(body.max_completion_tokens) &&
    body.max_completion_tokens > ceiling
  ) {
    body.max_completion_tokens = ceiling;
  }
}

function stripFixedSamplingParams(body) {
  for (const key of FIXED_SAMPLING_PARAMS) delete body[key];
}

function stripFixedTemperature(body) {
  delete body.temperature;
}

function isK2ThinkingDisabled(requested, enableThinking, existingThinking) {
  return (
    requested === "none" ||
    requested === "off" ||
    enableThinking === false ||
    existingThinking?.type === "disabled"
  );
}

function isK2ThinkingEnabled(requested, enableThinking, existingThinking) {
  return (
    Boolean(requested) ||
    enableThinking === true ||
    existingThinking?.type === "enabled" ||
    existingThinking?.type === "adaptive" ||
    existingThinking?.keep === "all"
  );
}

function normalizeK2Thinking(body, preservedThinkingOnly) {
  const existingThinking = asRecord(body.thinking);
  const reasoning = asRecord(body.reasoning);
  const requestedEffort = body.reasoning_effort ?? reasoning?.effort;
  const enableThinking = body.enable_thinking;
  delete body.reasoning_effort;
  delete body.reasoning;
  delete body.enable_thinking;

  if (preservedThinkingOnly) {
    body.thinking = { type: "enabled", keep: "all" };
    return;
  }

  const requested = typeof requestedEffort === "string" ? requestedEffort.toLowerCase() : "";
  const explicitlyDisabled = isK2ThinkingDisabled(requested, enableThinking, existingThinking);
  const explicitlyEnabled = isK2ThinkingEnabled(requested, enableThinking, existingThinking);

  if (explicitlyDisabled) {
    body.thinking = { type: "disabled" };
  } else if (explicitlyEnabled) {
    body.thinking = {
      type: "enabled",
      ...(existingThinking?.keep === "all" ? { keep: "all" } : {}),
    };
  } else {
    delete body.thinking;
  }
}

export function normalizeMoonshotRequest(model, body) {
  const record = asRecord(body);
  if (!record) return body;

  const normalizedModel = model.toLowerCase();
  if (!normalizedModel.startsWith("kimi-")) return body;

  const next = { ...record };
  if (Array.isArray(next.tools)) next.tools = flattenOpenAIToolRootAnyOf(next.tools);
  const isK3 = /^kimi-k3(?:$|-)/.test(normalizedModel);
  const isK27 = /^kimi-k2\.7-code(?:$|-)/.test(normalizedModel);
  const isK26 = /^kimi-k2\.6(?:$|-)/.test(normalizedModel);
  const outputCeiling = isK3 ? 1048576 : 262144;

  normalizeMaxCompletionTokens(next, outputCeiling);
  if (isK3 || isK27 || isK26) {
    stripFixedSamplingParams(next);
  } else {
    stripFixedTemperature(next);
  }

  if (isK3) {
    delete next.thinking;
    delete next.enable_thinking;
    delete next.reasoning;
    next.reasoning_effort = "max";
    return next;
  }

  normalizeK2Thinking(next, isK27);
  if ((isK27 || isK26) && next.tool_choice === "required") next.tool_choice = "auto";
  return next;
}

export class MoonshotExecutor extends DefaultExecutor {
  constructor(provider = "moonshot") {
    super(provider);
  }

  transformRequest(model, body, stream, credentials) {
    const normalized = normalizeMoonshotRequest(
      model,
      super.transformRequest(model, body, stream, credentials)
    );
    const record = asRecord(normalized);
    return stream && this.provider === "kimi" && record ? { ...record, stream: true } : normalized;
  }
}

export default MoonshotExecutor;
