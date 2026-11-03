// Strips Gemini's leaked leading planning JSON (e.g. `{"thought":"…"}`)
// emitted into VISIBLE text rather than as a `thought` part. Port of
// upstream's geminiPlanningLeak util.
//
// Scoped strictly to the definitive `thought` key signature to avoid false
// positives with JSON mode or tool schemas. The caller gates this to flash
// models (see gemini-to-openai.js), same as upstream.

export function isPlanningLeakPrefix(text) {
  const trimmed = text.trimStart();
  if (!trimmed.startsWith("{")) {
    return false;
  }
  const afterBrace = trimmed.slice(1).trimStart();
  if (afterBrace === "") {
    return trimmed.length <= 100;
  }
  if (afterBrace[0] !== '"') {
    return false;
  }
  const nextQuoteIndex = afterBrace.indexOf('"', 1);
  if (nextQuoteIndex === -1) {
    const keyPrefix = afterBrace.slice(1);
    return "thought".startsWith(keyPrefix) && trimmed.length <= 100;
  }
  const key = afterBrace.slice(1, nextQuoteIndex);
  if (key !== "thought") {
    return false;
  }
  const afterKey = afterBrace.slice(nextQuoteIndex + 1).trimStart();
  if (afterKey === "") {
    return trimmed.length <= 100;
  }
  if (afterKey[0] !== ":") {
    return false;
  }
  return true;
}

function advanceInsideString(state, ch) {
  if (state.escaped) {
    state.escaped = false;
  } else if (ch === "\\") {
    state.escaped = true;
  } else if (ch === '"') {
    state.inString = false;
  }
}

function advanceOutsideString(state, ch) {
  if (ch === '"') {
    state.inString = true;
  } else if (ch === "{") {
    state.depth += 1;
  } else if (ch === "}") {
    state.depth -= 1;
  }
}

/** Index of the `}` closing the object that opens at `text[0]`, or -1 if it never closes. */
function findJsonObjectEnd(text) {
  const state = { depth: 0, inString: false, escaped: false };

  for (let index = 0; index < text.length; index += 1) {
    const ch = text[index];
    if (state.inString) {
      advanceInsideString(state, ch);
      continue;
    }
    advanceOutsideString(state, ch);
    if (ch === "}" && state.depth === 0) return index;
  }

  return -1;
}

export function splitLeadingJsonObject(text) {
  const prefixLength = text.length - text.trimStart().length;
  const trimmed = text.slice(prefixLength);
  if (!trimmed.startsWith("{")) return undefined;

  const endIndex = findJsonObjectEnd(trimmed);
  if (endIndex === -1) return undefined;

  return {
    prefixLength: prefixLength + endIndex + 1,
    jsonText: trimmed.slice(0, endIndex + 1),
    rest: trimmed.slice(endIndex + 1),
  };
}

export function consumePlanningLeak(text, isFinal = false) {
  if (!isPlanningLeakPrefix(text)) {
    return { kind: "plain", visibleText: text };
  }

  const leading = splitLeadingJsonObject(text);

  if (!leading) {
    if (isFinal) {
      const trimmed = text.trim();
      if (trimmed.includes('"thought"')) {
        return { kind: "leak", visibleText: "" };
      }
      return { kind: "plain", visibleText: text };
    }
    return { kind: "incomplete" };
  }

  try {
    const parsed = JSON.parse(leading.jsonText);
    if (
      parsed &&
      typeof parsed === "object" &&
      typeof parsed.thought === "string"
    ) {
      return { kind: "leak", visibleText: leading.rest };
    }
  } catch {
    return { kind: "plain", visibleText: text };
  }

  return { kind: "plain", visibleText: text };
}

export class GeminiPlanningLeakFilter {
  constructor() {
    this.buffer = "";
    this.resolved = false;
  }

  feed(delta) {
    if (this.resolved) {
      return delta;
    }
    this.buffer += delta;

    const result = consumePlanningLeak(this.buffer, false);
    if (result.kind === "incomplete") {
      return "";
    }

    this.resolved = true;
    this.buffer = "";
    return result.visibleText;
  }

  flush() {
    if (this.resolved) {
      return "";
    }
    this.resolved = true;
    const result = consumePlanningLeak(this.buffer, true);
    this.buffer = "";
    return "visibleText" in result ? result.visibleText : "";
  }
}
