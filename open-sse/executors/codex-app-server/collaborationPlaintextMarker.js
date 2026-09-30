// #14154 — Codex MultiAgent V2 normally treats a collaboration function_call's
// arguments as backend ciphertext. An empty `encrypted_function_args` list is
// the protocol's explicit plaintext-delivery marker (codex-rs
// ToolCall::direct_source). The vendored ChatGPT-web bridge already emits it
// for its own call sites; this shared helper gives the general Responses-API
// output emitters the same contract.
//
// Ported from OmniRoute's
// open-sse/translator/response/openai-responses/collaborationPlaintextMarker.ts.

const PLAINTEXT_COLLABORATION_CALLS = new Set(["spawn_agent", "send_message", "followup_task"]);

/**
 * Return `{ encrypted_function_args: [] }` when `namespace`/`name` identify a
 * collaboration call that Codex expects delivered as plaintext, otherwise an
 * empty object — safe to spread onto any function_call item unconditionally.
 */
export function plaintextCollaborationFields(namespace, name) {
  return namespace === "collaboration" && !!name && PLAINTEXT_COLLABORATION_CALLS.has(name)
    ? { encrypted_function_args: [] }
    : {};
}
