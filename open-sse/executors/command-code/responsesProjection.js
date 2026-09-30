// Responses -> Chat projection for the /alpha/generate CLI fallback.
//
// Ported from OmniRoute's open-sse/executors/commandCode/responsesProjection.ts
// (types stripped). Self-contained; only isResponsesShapedBody and
// projectResponsesForCli are needed by the executor.

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringValue(value) {
  return typeof value === "string" ? value : undefined;
}

/**
 * True for an OpenAI Responses-shaped body (`input`, not `messages`). Command Code
 * serves OpenAI models on BOTH /chat/completions and /responses, but only the
 * Responses endpoint honors `reasoning: {"effort": "none"}` (the chat validator
 * accepts low|medium|high|xhigh|max only, and silently ignores a nested
 * `reasoning.effort`). Route Responses-shaped bodies there so a no-thinking
 * request can actually disable reasoning.
 *
 * `messages` is the Chat discriminator and WINS when both are present: `input` is
 * only consulted when `messages` is absent.
 */
export function isResponsesShapedBody(body) {
  if (!isRecord(body)) return false;
  return body.input !== undefined && body.messages === undefined;
}

function projectResponsesMessageItem(item, messages) {
  const role = stringValue(item.role);
  if (role !== "user" && role !== "system" && role !== "assistant") return false;
  messages.push({ role, content: item.content });
  return true;
}

function projectResponsesToolOutputItem(item, messages) {
  const callId = stringValue(item.call_id) ?? "";
  if (!callId) return false;
  messages.push({ role: "tool", tool_call_id: callId, content: item.output });
  return true;
}

/**
 * Project a Responses `function_call` item onto a Chat assistant `tool_calls`
 * entry. Consecutive calls — and a preceding assistant `message` — collapse into
 * one assistant turn, matching how Chat groups `tool_calls`.
 */
function projectResponsesFunctionCallItem(item, messages) {
  const callId = stringValue(item.call_id) ?? "";
  const name = stringValue(item.name) ?? "";
  if (!callId || !name) return false;
  const call = {
    id: callId,
    type: "function",
    function: { name, arguments: stringValue(item.arguments) ?? "{}" },
  };
  const last = messages[messages.length - 1];
  if (isRecord(last) && last.role === "assistant") {
    if (!Array.isArray(last.tool_calls)) last.tool_calls = [];
    last.tool_calls.push(call);
  } else {
    messages.push({ role: "assistant", content: null, tool_calls: [call] });
  }
  return true;
}

/**
 * Per-type projections from a Responses input item onto Chat messages. The map
 * keys are exactly the item types that have a faithful Chat form. Anything else
 * — `reasoning` items, built-in tool calls (`web_search_call`,
 * `local_shell_call`, …), and any future opaque item — has no CLI
 * representation. Bailing on those is the only honest option: silently dropping
 * the item would corrupt the replay.
 */
const RESPONSES_ITEM_PROJECTORS = {
  message: projectResponsesMessageItem,
  function_call: projectResponsesFunctionCallItem,
  function_call_output: projectResponsesToolOutputItem,
};

/**
 * Project Responses input items onto Chat messages in place. Returns false when
 * an item has no faithful Chat form.
 */
function projectResponsesItems(items, messages) {
  for (const item of items) {
    if (!isRecord(item)) return false;
    const type = typeof item.type === "string" ? item.type : "message";
    const project = RESPONSES_ITEM_PROJECTORS[type];
    if (!project || !project(item, messages)) return false;
  }
  return true;
}

/**
 * Project a Responses-shaped body onto the Chat shape `/alpha/generate` speaks.
 *
 * Returns `null` when the request has no faithful CLI form (see
 * `projectResponsesItems`); the caller then surfaces the upstream error rather
 * than replaying a mangled body. `instructions` maps onto `system`, since the
 * CLI body has no `instructions` field and would otherwise drop it.
 */
export function projectResponsesForCli(body) {
  const raw = body.input;
  const messages = [];

  if (typeof raw === "string") {
    messages.push({ role: "user", content: raw });
  } else if (Array.isArray(raw)) {
    if (!projectResponsesItems(raw, messages)) return null;
    if (messages.length === 0) return null;
  } else {
    return null;
  }

  const out = { ...body, messages };
  delete out.input;
  if (typeof body.max_output_tokens === "number") {
    out.max_tokens = body.max_output_tokens;
  }
  delete out.max_output_tokens;

  const instructions = stringValue(body.instructions);
  if (instructions && !stringValue(out.system)) {
    out.system = instructions;
  }
  delete out.instructions;

  return out;
}
