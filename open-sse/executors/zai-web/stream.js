// zai-web stream translation — ported from OmniRoute's
// open-sse/executors/zai-web/stream.ts (types stripped).
//
// Parses the z.ai SSE wire frames (OpenAI-shaped frames or the site's internal
// envelope frames) into { content, reasoning, done, error? } deltas, then
// re-emits OpenAI chat-completion chunks or collects the full answer.
//
// Port note: buildErrorBody() is a small local approximation (control-char
// stripping + length cap); the OmniRoute original redacts secrets and projects
// public error identifiers.
function sanitizeErrorMessage(message) {
  return String(message ?? "")
    .replace(/[\x00-\x1F\x7F]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 2000);
}

function buildErrorBody(statusCode, message, _upstreamDetails, classification) {
  return {
    error: {
      message: sanitizeErrorMessage(message) || `Z.ai error (HTTP ${statusCode})`,
      type:
        classification && typeof classification.type === "string"
          ? classification.type
          : "upstream_error",
      code:
        classification && typeof classification.code === "string"
          ? classification.code
          : `HTTP_${statusCode}`,
    },
  };
}

/**
 * Pull a human-readable message out of an error-shaped frame.
 *
 * z.ai answers some failures with HTTP 200 and an error payload in the SSE body
 * (rejected signature, expired captcha, stale token). Those frames carry no
 * `delta_content`, so without this they take the same "no usable delta" path as
 * a benign phase frame and are dropped — the caller then sees a successful
 * empty completion. Only an *explicit* error field counts: contentless frames
 * remain a normal, skipped part of the protocol.
 */
function readFrameError(frame) {
  const data = frame.data ?? {};
  const raw = frame.error ?? data.error;
  if (!raw) return null;

  if (typeof raw === "string") return sanitizeErrorMessage(raw) || "upstream error";
  if (typeof raw === "object") {
    const rec = raw;
    const message = rec.detail ?? rec.message ?? rec.msg;
    if (typeof message === "string" && message) return sanitizeErrorMessage(message);
    return sanitizeErrorMessage(JSON.stringify(raw));
  }
  return sanitizeErrorMessage(String(raw));
}

function parseOpenAiShapedFrame(choices) {
  const delta = choices[0]?.delta ?? {};
  const finishReason = choices[0]?.finish_reason;
  return {
    content: typeof delta.content === "string" ? delta.content : "",
    reasoning: typeof delta.reasoning_content === "string" ? delta.reasoning_content : "",
    done: finishReason != null,
  };
}

function parseInternalEnvelopeFrame(frame, data) {
  const phase = String(data.phase ?? "");
  const deltaContent = data.delta_content ?? data.edit_content ?? data.content;
  const done =
    data.done === true ||
    phase === "done" ||
    phase === "finish" ||
    String(frame.type ?? "") === "chat:completion:finish";

  if (typeof deltaContent === "string" && deltaContent) {
    const isThinking = phase === "thinking";
    return {
      content: isThinking ? "" : deltaContent,
      reasoning: isThinking ? deltaContent : "",
      done,
    };
  }
  if (done) return { content: "", reasoning: "", done: true };
  return null;
}

export function parseZaiFrame(raw) {
  if (!raw || typeof raw !== "object") return null;
  const frame = raw;

  // Checked before the delta paths: an error frame is terminal, and must not
  // fall through to the "no usable delta" null that would silently drop it.
  const error = readFrameError(frame);
  if (error) return { content: "", reasoning: "", done: true, error };

  const choices = frame.choices;
  if (Array.isArray(choices) && choices.length > 0) {
    return parseOpenAiShapedFrame(choices);
  }

  const data = frame.data ?? frame;
  return parseInternalEnvelopeFrame(frame, data);
}

function extractSseDataPayloads(buffer, incoming) {
  buffer.text += incoming;
  const lines = buffer.text.split("\n");
  buffer.text = lines.pop() || "";
  const payloads = [];
  for (const line of lines) {
    if (!line.startsWith("data:")) continue;
    const data = line.slice(5).trim();
    if (!data || data === "[DONE]") continue;
    payloads.push(data);
  }
  return payloads;
}

function parseSsePayload(data) {
  try {
    return parseZaiFrame(JSON.parse(data));
  } catch {
    return null;
  }
}

function createZaiDeltaSource(sourceBody) {
  const decoder = new TextDecoder();
  const reader = sourceBody.getReader();
  const buffer = { text: "" };
  let upstreamDone = false;
  let cancelRequested = false;
  let readerReleased = false;

  const releaseReader = () => {
    if (readerReleased) return;
    readerReleased = true;
    try {
      reader.releaseLock();
    } catch {
      // A concurrent read cancellation owns the final release.
    }
  };

  const cancel = (reason) => {
    if (upstreamDone || cancelRequested) return;
    cancelRequested = true;
    try {
      // Do not await an upstream cancel hook: a stalled provider is allowed to
      // ignore cancellation, but it must never keep the client cancellation open.
      void reader.cancel(reason).catch(() => {});
    } catch {
      // The reader may already have closed or released concurrently.
    }
  };

  async function* iterate() {
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          upstreamDone = true;
          return;
        }
        const payloads = extractSseDataPayloads(buffer, decoder.decode(value, { stream: true }));
        for (const raw of payloads) {
          const delta = parseSsePayload(raw);
          if (delta) yield delta;
        }
      }
    } finally {
      if (!upstreamDone && !cancelRequested) cancel("Z.ai delta iteration ended");
      releaseReader();
    }
  }

  return { deltas: iterate(), cancel };
}

async function drainSseDeltas(sourceBody, onDelta) {
  const { deltas } = createZaiDeltaSource(sourceBody);
  for await (const delta of deltas) {
    if (onDelta(delta)) return true;
  }
  return false;
}

function emitDeltaChunks(controller, delta, emitChunk, roleState) {
  if (delta.error) {
    const errorBody = buildErrorBody(502, `Z.ai stream failed: ${delta.error}`, undefined, {
      type: "upstream_error",
      code: "zai_stream_error",
    });

    if (!roleState.emitted) {
      // Keep a pre-content failure as an error-only Chat frame. Stream readiness
      // rejects it before response headers are committed, so fallback receives a 502.
      controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(errorBody)}\n\n`));
      controller.close();
    } else {
      // Once content is public, error the protocol-neutral producer. The shared
      // pipeline preserves prior chunks, records the failure, and emits the terminal
      // error in the client's native Chat, Claude, or Responses wire format.
      controller.error(Object.assign(new Error(errorBody.error.message), { statusCode: 502 }));
    }
    return true;
  }

  if (!roleState.emitted && (delta.content || delta.reasoning)) {
    roleState.emitted = true;
    emitChunk(controller, { role: "assistant", content: "" });
  }
  if (delta.reasoning) emitChunk(controller, { reasoning_content: delta.reasoning });
  if (delta.content) emitChunk(controller, { content: delta.content });
  if (delta.done) {
    emitChunk(controller, {}, "stop");
    controller.enqueue(new TextEncoder().encode("data: [DONE]\n\n"));
    controller.close();
    return true;
  }
  return false;
}

export function buildZaiStreamingBody(sourceBody, emitChunk, signal) {
  const deltaSource = createZaiDeltaSource(sourceBody);
  const { deltas } = deltaSource;
  const roleState = { emitted: false };
  let terminated = false;

  return new ReadableStream({
    async pull(controller) {
      if (terminated) return;
      try {
        const next = await deltas.next();
        if (terminated) return;
        if (next.done === false) {
          if (emitDeltaChunks(controller, next.value, emitChunk, roleState)) {
            terminated = true;
            await deltas.return(undefined);
          }
          return;
        }

        terminated = true;
        if (!roleState.emitted) emitChunk(controller, { role: "assistant", content: "" });
        emitChunk(controller, {}, "stop");
        controller.enqueue(new TextEncoder().encode("data: [DONE]\n\n"));
        controller.close();
      } catch (error) {
        terminated = true;
        if (!signal?.aborted) {
          try {
            controller.error(error);
          } catch {
            // The controller was already closed.
          }
        }
      }
    },
    cancel(reason) {
      terminated = true;
      deltaSource.cancel(reason);
      void deltas.return(undefined).catch(() => {});
    },
  });
}

export async function collectZaiNonStreaming(sourceBody) {
  let answer = "";
  let reasoning = "";
  await drainSseDeltas(sourceBody, (delta) => {
    // Match the streaming path: an upstream error frame (rejected signature,
    // expired captcha, stale token) must surface as a failed request, not as a
    // successful empty completion. The caller converts this throw into an error
    // result (e.g. 502), so the client is never left reading an empty 200.
    if (delta.error) throw new Error(delta.error);
    if (delta.reasoning) reasoning += delta.reasoning;
    if (delta.content) answer += delta.content;
    return delta.done;
  });
  return { answer, reasoning };
}

export function makeZaiChunkEmitter(id, created, modelId) {
  return (controller, delta, finish = null) => {
    const chunk = {
      id,
      object: "chat.completion.chunk",
      created,
      model: modelId,
      choices: [{ index: 0, delta, finish_reason: finish }],
    };
    controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(chunk)}\n\n`));
  };
}
