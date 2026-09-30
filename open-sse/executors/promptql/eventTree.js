// PromptQL executor — AgentMessage event-tree text extraction
// (ported from OmniRoute executors/promptql/eventTree.ts).
//
// thread_events rows carry a deeply-nested `event_data` blob; the assistant's
// final reply lives at a `final_response.message` leaf (or, on older builds,
// embedded as `<final_response>…</final_response>` XML inside `response_text`).

export function walkStrings(node, out = [], path = "") {
  if (node == null) return out;
  if (typeof node === "string") {
    if (
      node.length >= 1 &&
      !/^[0-9a-f-]{36}$/i.test(node) &&
      !/^\d{4}-\d{2}-\d{2}T/.test(node)
    ) {
      out.push({ path, text: node });
    }
    return out;
  }
  if (Array.isArray(node)) {
    node.forEach((v, i) => walkStrings(v, out, `${path}[${i}]`));
    return out;
  }
  if (typeof node === "object") {
    for (const [k, v] of Object.entries(node)) {
      walkStrings(v, out, path ? `${path}.${k}` : k);
    }
  }
  return out;
}

export function extractFinalResponseMessage(eventData) {
  const hits = walkStrings(eventData).filter((t) => /final_response\.message$/i.test(t.path));
  if (hits.length) return hits[hits.length - 1].text;
  // response_text XML fallback
  const raw = walkStrings(eventData).find((t) => /response_text$/i.test(t.path));
  if (raw) {
    const m = raw.text.match(/<final_response>\s*([\s\S]*?)\s*<\/final_response>/i);
    if (m) return m[1].trim();
  }
  return null;
}

export function isFinalAgentEvent(eventData) {
  const s = JSON.stringify(eventData || {});
  if (s.includes("final_response_sent")) return true;
  return Boolean(extractFinalResponseMessage(eventData));
}

export function eventKind(eventData) {
  if (!eventData || typeof eventData !== "object") return "unknown";
  return Object.keys(eventData)[0] || "unknown";
}
