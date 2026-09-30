/**
 * Browser-TLS-impersonating HTTP client for arena.ai.
 *
 * Focused port of OmniRoute's open-sse/services/lmarenaTlsClient.ts facade
 * (which delegates to the shared tlsClientBase factory over wreq-js).
 *
 * Same provider config:
 *   providerName: "LMArena", tlsProfile: "chrome_146", emulationOs: "windows",
 *   responseValidation: "cf", defaultTimeoutMs: 60_000, hardTimeoutGraceMs: 10_000.
 *
 * Upstream sits behind Cloudflare, so plain fetch fails bot checks; traffic
 * needs wreq-js Chrome impersonation. If `wreq-js` is not installed or the
 * platform binding is unsupported, tlsFetchLMArena throws
 * TlsClientUnavailableError and the executor maps that to a 502
 * `TLS_CLIENT_UNAVAILABLE` result — matching source behavior.
 */

import * as nodeModule from "node:module";

export class TlsClientUnavailableError extends Error {
  constructor(message) {
    super(message);
    this.name = "TlsClientUnavailableError";
  }
}

export class TlsClientHangError extends Error {
  constructor(message) {
    super(message);
    this.name = "TlsClientHangError";
  }
}

export function isCloudflareChallenge(text) {
  if (!text) return false;
  return /just a moment|window\._cf_chl_opt|challenges\.cloudflare\.com|attention required|cf-chl/i.test(
    text
  );
}

const DEFAULT_TIMEOUT_MS = 60_000;
const HARD_TIMEOUT_GRACE_MS = 10_000;

let wreqRuntimeModule = null;
let wreqRuntimeModuleError;
let wreqRuntimeModuleResolved = false;

function getWreqRuntimeModule() {
  if (wreqRuntimeModuleResolved) {
    if (wreqRuntimeModule) return wreqRuntimeModule;
    throw wreqRuntimeModuleError ?? new Error("wreq-js runtime unavailable");
  }
  wreqRuntimeModuleResolved = true;
  try {
    // Keep the specifier dynamic (bundlers rewrite literal createRequire calls).
    const runtimeRequire = nodeModule.createRequire(process.argv[1] || process.cwd());
    const specifier = "wreq" + "-js";
    wreqRuntimeModule = runtimeRequire(specifier);
  } catch (error) {
    wreqRuntimeModuleError = error;
    throw error;
  }
  return wreqRuntimeModule;
}

let testOverride = null;

/** Test seam (mirrors the source's `__setTlsFetchOverrideForTesting`). */
export function __setTlsFetchOverrideForTesting(fn) {
  testOverride = fn;
}

let sessionPromise = null;

function getSession() {
  if (!sessionPromise) {
    sessionPromise = (async () => {
      let runtime;
      try {
        runtime = getWreqRuntimeModule();
      } catch (error) {
        throw new TlsClientUnavailableError(
          "wreq-js 3.2.x is not installed or unsupported on this platform — cannot start browser transport for LMArena"
        );
      }
      if (typeof runtime.createSession === "function") {
        return runtime.createSession({ browser: "chrome_146", os: "windows" });
      }
      throw new TlsClientUnavailableError(
        "wreq-js runtime is missing createSession — cannot start browser transport for LMArena"
      );
    })();
    sessionPromise.catch(() => {
      // A failed session must not be cached forever; a later call may succeed.
      if (sessionPromise) {
        sessionPromise = null;
      }
    });
  }
  return sessionPromise;
}

function withTimeout(signal, timeoutMs) {
  if (!timeoutMs || timeoutMs <= 0) return { signal, cleanup: () => {} };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new TlsClientHangError("TLS request timed out")), timeoutMs);
  if (signal) {
    if (signal.aborted) {
      clearTimeout(timer);
      controller.abort(signal.reason);
    } else {
      signal.addEventListener("abort", () => controller.abort(signal.reason), { once: true });
    }
  }
  return { signal: controller.signal, cleanup: () => clearTimeout(timer) };
}

/** Drain a ReadableStream<Uint8Array> to text (used when the wreq response has no .text()). */
async function streamToText(body, signal) {
  if (!body) return "";
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let text = "";
  try {
    while (true) {
      if (signal?.aborted) break;
      const { done, value } = await reader.read();
      if (done) break;
      text += decoder.decode(value, { stream: true });
    }
  } finally {
    text += decoder.decode();
    try {
      reader.releaseLock();
    } catch {}
  }
  return text;
}

/**
 * Fetch through the wreq-js Chrome-impersonating transport.
 * Returns { status, text, body } — body is a ReadableStream<Uint8Array>|null
 * (present when options.stream is true).
 */
export async function tlsFetchLMArena(url, options = {}) {
  if (testOverride) return testOverride(url, options);

  const { method = "GET", headers, body, signal = null, stream = false, proxy } = options;
  const timeoutMs = DEFAULT_TIMEOUT_MS + HARD_TIMEOUT_GRACE_MS;
  const { signal: reqSignal, cleanup } = withTimeout(signal, timeoutMs);

  try {
    const session = await getSession();
    const response = await session.fetch(url, {
      method,
      headers,
      body,
      signal: reqSignal,
      ...(proxy === undefined ? {} : { proxy }),
    });

    if (!stream) {
      const text =
        typeof response.text === "function"
          ? await response.text()
          : await streamToText(response.body, reqSignal);
      if (isCloudflareChallenge(text)) {
        // CF response validation: treat a challenge page as a bot-blocked result.
        return { status: response.status, text, body: null };
      }
      return { status: response.status, text, body: null };
    }

    return {
      status: response.status,
      text: null,
      body: response.body ?? null,
    };
  } catch (error) {
    if (error instanceof TlsClientUnavailableError) throw error;
    if (error instanceof TlsClientHangError) throw error;
    if (error?.name === "AbortError" && reqSignal?.aborted && !(signal?.aborted)) {
      throw new TlsClientHangError("TLS request timed out");
    }
    throw error;
  } finally {
    cleanup();
  }
}
