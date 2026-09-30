// UC (uncensored.com) PERSONA WebSocket driver.
// Ported from OmniRoute's open-sse/executors/uc/ws.ts (types stripped).
//
// Opens one socket per turn (connect → send the persona frame → stream frames →
// close). Auth is 100% the `?token=` query param (a 60s Clerk JWT); the ONLY
// required handshake header is `Origin: https://uncensored.com` (the backend
// checks it — NO Cookie, NO Authorization on the upgrade).
//
// The driver is transport-only: it classifies frames via UcFrameParser and hands
// each event to an `onEvent` callback, so the executor can drive both a live
// OpenAI SSE stream and a buffered non-streaming response from the same path.
//
// Transport: prefers the `ws` npm package when installed (carries handshake
// headers — `Origin` is required by the UC backend) and falls back to the
// platform WebSocket otherwise, in which case the handshake carries NO Origin
// and the backend will likely reject the connection.
import { UC_ORIGIN, UC_WS_HOST, UC_WS_TIMEOUT_MS } from "./constants.js";
import { buildPersonaFrame } from "./protocol.js";
import { UcFrameParser } from "./stream.js";

let WebSocketCtor = null;

/** Resolve the WebSocket constructor: `ws` npm package first, else built-in. */
async function resolveWebSocketCtor() {
  if (WebSocketCtor) return WebSocketCtor;
  try {
    const mod = await import("ws");
    WebSocketCtor = mod.default ?? mod.WebSocket;
  } catch {
    if (!globalThis.WebSocket) throw new Error("no WebSocket implementation available");
    WebSocketCtor = globalThis.WebSocket;
  }
  return WebSocketCtor;
}

/** Inject a fake WebSocket constructor for tests. Returns a restore fn. */
export async function __setUcWebSocketForTesting(ctor) {
  const previous = WebSocketCtor;
  WebSocketCtor = ctor;
  return () => {
    WebSocketCtor = previous;
  };
}

/** Build the persona WS URL: wss://.../ws/{uid}?token={jwt}&_t={epochms}. */
export function buildUcWsUrl(uid, jwt) {
  return `${UC_WS_HOST}/${encodeURIComponent(uid)}?token=${encodeURIComponent(jwt)}&_t=${Date.now()}`;
}

/**
 * Drive one persona turn to completion. Never rejects — a transport/timeout/error
 * failure resolves with `{ error }` set (and any partial content). The caller
 * decides whether a partial is usable or should surface the error.
 */
export async function runUcTurn(input) {
  const Ctor = await resolveWebSocketCtor();
  const supportsHeaders = await (async () => {
    try {
      const mod = await import("ws");
      return (mod.default ?? mod.WebSocket) === Ctor;
    } catch {
      return false;
    }
  })();
  const timeoutMs = input.timeoutMs ?? UC_WS_TIMEOUT_MS;
  const url = buildUcWsUrl(input.uid, input.jwt);
  const parser = new UcFrameParser();
  const reasoningParts = [];

  return new Promise((resolve) => {
    let ws;
    try {
      ws = supportsHeaders
        ? new Ctor(url, { headers: { Origin: UC_ORIGIN } })
        : new Ctor(url);
      if (!supportsHeaders && typeof ws.binaryType === "string") {
        ws.binaryType = "arraybuffer";
      }
    } catch (err) {
      resolve({
        content: "",
        reasoning: "",
        error: `ws connect failed: ${err instanceof Error ? err.message : String(err)}`,
      });
      return;
    }

    let settled = false;
    let errorText;
    let timeout = null;
    let abortHandler = null;

    const finish = (result) => {
      if (settled) return;
      settled = true;
      if (timeout) clearTimeout(timeout);
      if (input.signal && abortHandler) input.signal.removeEventListener("abort", abortHandler);
      try {
        ws.close();
      } catch {
        /* ignore */
      }
      resolve(result);
    };

    const fail = (error) =>
      finish({ content: parser.accumulated.trim(), reasoning: reasoningParts.join(""), error });

    timeout = setTimeout(
      () => fail(`UC persona WS timed out (readyState=${ws.readyState})`),
      timeoutMs
    );
    abortHandler = () => fail("Request aborted");
    input.signal?.addEventListener("abort", abortHandler, { once: true });

    const onOpen = () => {
      try {
        const frame = buildPersonaFrame({
          model: input.model,
          text: input.text,
          history: input.history,
          uid: input.uid,
          media: input.media,
        });
        ws.send(JSON.stringify(frame));
      } catch (err) {
        fail(`ws send failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    };

    const onMessage = (event) => {
      let raw = "";
      const data = event?.data ?? event;
      if (typeof data === "string") {
        raw = data;
      } else if (Buffer.isBuffer(data)) {
        raw = data.toString("utf-8");
      } else if (data instanceof ArrayBuffer) {
        raw = new TextDecoder().decode(data);
      } else if (ArrayBuffer.isView(data)) {
        raw = new TextDecoder().decode(data);
      } else if (data && typeof data.text === "function") {
        // DOM Blob — async decode; re-feed when ready.
        data.text().then((t) => onMessage(t)).catch(() => {});
        return;
      }
      if (!raw) return;

      for (const evt of parser.feed(raw)) {
        input.onEvent?.(evt);
        if (evt.kind === "reasoning") {
          reasoningParts.push(evt.text);
        } else if (evt.kind === "error") {
          errorText = evt.text;
        } else if (evt.kind === "done") {
          finish({ content: evt.text, reasoning: reasoningParts.join("") });
          return;
        }
      }
      if (parser.done) {
        // Terminal error frame consumed by the parser.
        finish({
          content: parser.accumulated.trim(),
          reasoning: reasoningParts.join(""),
          error: errorText,
        });
      }
    };

    const onError = () => fail("UC persona WebSocket connection error");
    const onClose = () => {
      if (settled) return;
      // Closed without an explicit end_of_stream: use whatever we accumulated.
      finish({
        content: parser.finalText(),
        reasoning: reasoningParts.join(""),
        error: errorText,
      });
    };

    if (typeof ws.on === "function") {
      ws.on("open", onOpen);
      ws.on("message", onMessage);
      ws.on("close", onClose);
      ws.on("error", onError);
    } else {
      ws.onopen = onOpen;
      ws.onmessage = onMessage;
      ws.onclose = onClose;
      ws.onerror = onError;
    }
  });
}
