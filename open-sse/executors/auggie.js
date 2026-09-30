// AuggieExecutor — ported from OmniRoute's auggie executor.
//
// Routes completions through the local Augment CLI ("auggie") binary via a
// one-shot stdin/stdout text pipe (no JSON-RPC / ACP protocol):
//   1. Flatten the OpenAI-shaped messages[] into a single prompt string.
//   2. Spawn `auggie --print --quiet --model <model>` and pipe the prompt on stdin.
//   3. Relay stdout chunks as OpenAI-compatible SSE deltas (stream=true) or
//      buffer them into a single chat.completion JSON body (stream=false).
//   4. Kill the subprocess on abort / stream close.
//
// Auth: none. Auggie delegates auth entirely to the user's local `auggie login`
// session. Binary discovery: AUGGIE_BIN / CLI_AUGGIE_BIN env var, PATH lookup,
// Windows installer path, ~/.local/share/auggie/bin/auggie, ~/.auggie/bin/auggie.
import { spawn } from "node:child_process";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import { BaseExecutor } from "./base.js";
import { PROVIDERS } from "../config/providers.js";

const AUGGIE_URL = "auggie://cli/stdio";

function getAuggieModelIds() {
  const models = PROVIDERS["auggie"]?.models;
  return Array.isArray(models) ? models.map((m) => m.id) : [];
}

const DEFAULT_AUGGIE_MODEL = "sonnet4.6";

// Old model IDs from before the registry rename; each maps to the current ID
// so existing combos continue to work.
const AUGGIE_MODEL_ALIASES = new Map([
  ["claude-sonnet-4.6", "sonnet4.6"],
  ["claude-sonnet-4.6-thinking", "sonnet4.6"],
  ["claude-opus-4.6", "opus4.6"],
  ["claude-haiku-4.5", "haiku4.5"],
  ["gemini-3.1-pro", "gemini-3.1-pro-preview"],
  ["gemini-3.0-flash", "gemini-3.1-pro-preview"],
  ["gpt-5.5-high", "gpt5.5"],
  ["gpt-5.5-medium", "gpt5.5"],
  ["gpt-5.4-high", "gpt5.4"],
  ["gpt-5.4-medium", "gpt5.4"],
]);

function sanitizeErrorMessage(msg) {
  return String(msg || "").replace(/[\r\n]+/g, " ").slice(0, 2000);
}

function buildErrorBody(status, message) {
  return { error: { message: sanitizeErrorMessage(message), type: "upstream_error", code: String(status) } };
}

function errorResponse(status, message) {
  return new Response(JSON.stringify(buildErrorBody(status, message)), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

// Live model cache populated by initAuggieModels(): null = not yet attempted.
let liveModelSet = null;

export async function initAuggieModels(signal, timeoutMs = 8000) {
  if (liveModelSet !== null) return;
  let bin;
  try {
    bin = resolveAuggieBin();
  } catch {
    liveModelSet = new Set();
    return;
  }
  const child = spawn(bin, ["model", "list"], buildAuggieSpawnOptions(["ignore", "pipe", "pipe"]));
  const fragments = [];
  child.stdout.on("data", (d) => fragments.push(d.toString("utf8")));
  let settled = false;
  const settle = (result) => {
    if (settled) return;
    settled = true;
    liveModelSet = result;
  };
  const timer = setTimeout(() => {
    if (!child.killed) child.kill("SIGKILL");
    settle(new Set());
  }, timeoutMs);
  const onAbort = () => {
    if (!child.killed) child.kill("SIGKILL");
    clearTimeout(timer);
    settle(new Set());
  };
  if (signal) {
    if (signal.aborted) {
      clearTimeout(timer);
      settle(new Set());
      return;
    }
    signal.addEventListener("abort", onAbort, { once: true });
  }
  try {
    const code = await new Promise((resolve, reject) => {
      child.on("close", resolve);
      child.on("error", reject);
    });
    clearTimeout(timer);
    signal?.removeEventListener("abort", onAbort);
    if (code !== 0) {
      settle(new Set());
      return;
    }
    const ids = new Set();
    for (const line of fragments.join("").split("\n")) {
      const m = line.match(/\[([^\]]+)\]/);
      if (m) ids.add(m[1]);
    }
    settle(ids.size > 0 ? ids : new Set());
  } catch {
    clearTimeout(timer);
    settle(new Set());
    signal?.removeEventListener("abort", onAbort);
  }
}

function isAuggieModelFailure(resolution) {
  return !resolution.ok;
}

export function resolveAuggieModel(model) {
  const requested = typeof model === "string" ? model.trim() : "";
  if (!requested) return { ok: true, model: DEFAULT_AUGGIE_MODEL };
  if (requested.startsWith("-")) {
    return {
      ok: false,
      error: `Invalid Auggie model "${requested}": model must not start with "-".`,
    };
  }
  const requestedAlias = AUGGIE_MODEL_ALIASES.get(requested);
  if (requestedAlias) return { ok: true, model: requestedAlias };
  const allowlist = new Set(getAuggieModelIds());
  if (allowlist.has(requested)) return { ok: true, model: requested };
  if (liveModelSet?.has(requested)) return { ok: true, model: requested };
  const known = [...allowlist];
  if (liveModelSet) known.push(...liveModelSet);
  return {
    ok: false,
    error: `Unknown Auggie model "${requested}". Supported models: ${known.join(", ")}.`,
  };
}

function buildAuggieArgs(model) {
  return ["--print", "--quiet", "--model", model, "--"];
}

export function buildAuggieSpawnOptions(stdio) {
  return {
    env: process.env,
    stdio,
    shell: process.platform === "win32",
    windowsHide: true,
  };
}

export function resolveAuggieBin() {
  const envBin = (process.env.AUGGIE_BIN || process.env.CLI_AUGGIE_BIN || "").trim();
  if (envBin) return envBin;

  const isWin = process.platform === "win32";
  if (isWin) {
    const localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local");
    const winPath = path.join(localAppData, "auggie", "bin", "auggie.exe");
    if (fs.existsSync(winPath)) return winPath;
  }

  const home = os.homedir();
  for (const candidate of [
    path.join(home, ".local", "share", "auggie", "bin", "auggie"),
    path.join(home, ".auggie", "bin", "auggie"),
  ]) {
    if (fs.existsSync(candidate)) return candidate;
  }

  return isWin ? "auggie.cmd" : "auggie";
}

export function buildAuggiePrompt(messages) {
  const lines = [];
  for (const m of messages) {
    const role = String(m.role || "user");
    let text = "";
    if (typeof m.content === "string") {
      text = m.content;
    } else if (Array.isArray(m.content)) {
      for (const p of m.content) {
        if (p && typeof p === "object" && p.type === "text") {
          text += String(p.text || "");
        }
      }
    }
    lines.push(`${role}: ${text}`);
  }
  return lines.join("\n\n");
}

function isEnoentLike(message) {
  return message.includes("ENOENT") || message.includes("not found");
}

const AUGGIE_QUOTA_EXHAUSTED_PATTERNS = [
  /you have run out of usage/i,
  /run out of usage for/i,
  /usage limit exceeded/i,
];

export function isAuggieQuotaExhaustedText(text) {
  return AUGGIE_QUOTA_EXHAUSTED_PATTERNS.some((pattern) => pattern.test(text));
}

const AUGGIE_QUOTA_EXHAUSTED_CODE = "AUGGIE_QUOTA_EXHAUSTED";

function buildAuggieQuotaErrorResponse(message) {
  return new Response(
    JSON.stringify({
      error: {
        message: sanitizeErrorMessage(message),
        type: "upstream_error",
        code: AUGGIE_QUOTA_EXHAUSTED_CODE,
      },
    }),
    { status: 429, headers: { "Content-Type": "application/json" } }
  );
}

function buildAuggieSseError(message) {
  const body = `data: ${JSON.stringify(buildErrorBody(502, message))}\n\ndata: [DONE]\n\n`;
  return new Response(body, {
    status: 200,
    headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" },
  });
}

const CLI_NOT_FOUND_STDERR_PATTERNS = [
  /is not recognized as an internal or external command/i,
  /command not found/i,
  /:\s*not found\s*$/im,
  /No such file or directory/i,
];

function isCliNotFoundText(stderrTail) {
  return CLI_NOT_FOUND_STDERR_PATTERNS.some((pattern) => pattern.test(stderrTail));
}

function cliNotFoundMessage(bin) {
  return sanitizeErrorMessage(
    `Auggie CLI not found: ${bin}. Install it and run "auggie login", or set AUGGIE_BIN to an absolute path.`
  );
}

export class AuggieExecutor extends BaseExecutor {
  constructor(provider = "auggie") {
    super(provider, { id: provider, baseUrl: "" });
  }

  buildUrl() {
    return AUGGIE_URL;
  }

  buildHeaders() {
    return {};
  }

  transformRequest() {
    return null;
  }

  // No-op — auggie has no 9router-managed credentials to refresh.
  async refreshCredentials(credentials) {
    return null;
  }

  async execute({ model, body, stream, signal, log }) {
    const b = body ?? {};
    const messages = Array.isArray(b.messages) ? b.messages : [];
    const promptText = buildAuggiePrompt(messages);
    const auggieBin = resolveAuggieBin();
    const wantsStream = stream !== false;

    await initAuggieModels(signal);
    const modelResolution = resolveAuggieModel(model);
    if (isAuggieModelFailure(modelResolution)) {
      const response = wantsStream
        ? buildAuggieSseError(modelResolution.error)
        : errorResponse(400, modelResolution.error);
      return { response, url: AUGGIE_URL, headers: {}, transformedBody: { error: true } };
    }
    const safeModel = modelResolution.model;

    log?.info?.("AUGGIE", `auggie --print → model=${safeModel}, bin=${auggieBin}, stream=${wantsStream}`);

    const response = wantsStream
      ? this.runStreaming(auggieBin, safeModel, promptText, signal, log)
      : await this.runNonStreaming(auggieBin, safeModel, promptText, signal, log);

    return {
      response,
      url: AUGGIE_URL,
      headers: {},
      transformedBody: { model: safeModel, promptLength: promptText.length },
    };
  }

  spawnAuggie(auggieBin, model, promptText) {
    const child = spawn(auggieBin, buildAuggieArgs(model), buildAuggieSpawnOptions(["pipe", "pipe", "pipe"]));
    child.stdin.on("error", () => {});
    try {
      child.stdin.write(promptText);
      child.stdin.end();
    } catch {
      // ignore — 'error'/'close' handlers surface the failure
    }
    return child;
  }

  runStreaming(auggieBin, model, promptText, signal, log) {
    const responseId = `chatcmpl-auggie-${Date.now()}`;
    const created = Math.floor(Date.now() / 1000);

    let finished = false;
    const finish = () => {
      finished = true;
    };

    const sseStream = new ReadableStream({
      start: (controller) => {
        const emit = (chunk) => {
          if (finished) return;
          controller.enqueue(new TextEncoder().encode(chunk));
        };

        const emitDelta = (delta) => {
          emit(
            `data: ${JSON.stringify({
              id: responseId,
              object: "chat.completion.chunk",
              created,
              model,
              choices: [{ index: 0, delta: { content: delta }, finish_reason: null }],
            })}\n\n`
          );
        };

        const emitError = (message, statusCode = 502) => {
          emit(`data: ${JSON.stringify(buildErrorBody(statusCode, message))}\n\n`);
          emit("data: [DONE]\n\n");
          finish();
        };

        const emitStop = () => {
          emit(
            `data: ${JSON.stringify({
              id: responseId,
              object: "chat.completion.chunk",
              created,
              model,
              choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
            })}\n\n`
          );
          emit("data: [DONE]\n\n");
          finish();
        };

        let child;
        try {
          child = spawn(auggieBin, buildAuggieArgs(model), buildAuggieSpawnOptions(["pipe", "pipe", "pipe"]));
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          emitError(isEnoentLike(message) ? cliNotFoundMessage(auggieBin) : sanitizeErrorMessage(message));
          return;
        }

        child.stdin.on("error", () => {});
        try {
          child.stdin.write(promptText);
          child.stdin.end();
        } catch {
          // ignore — error/close handlers below surface failures
        }

        if (signal) {
          signal.addEventListener("abort", () => {
            if (!child.killed) child.kill("SIGTERM");
            finish();
          });
        }

        child.on("error", (err) => {
          const message = err?.message || String(err);
          emitError(isEnoentLike(message) ? cliNotFoundMessage(auggieBin) : sanitizeErrorMessage(message));
        });

        let stderrTail = "";
        const QUOTA_DETECTION_BUFFER_BYTES = 2048;
        let pendingBuffer = "";
        let bufferFlushed = false;
        let quotaDetected = false;

        const flushPendingBuffer = () => {
          if (bufferFlushed) return;
          bufferFlushed = true;
          if (isAuggieQuotaExhaustedText(pendingBuffer)) {
            quotaDetected = true;
            emitError(sanitizeErrorMessage(pendingBuffer.trim()), 429);
            return;
          }
          if (pendingBuffer) emitDelta(pendingBuffer);
          pendingBuffer = "";
        };

        child.stdout?.on("data", (chunk) => {
          if (quotaDetected || finished) return;
          if (bufferFlushed) {
            emitDelta(chunk.toString("utf8"));
            return;
          }
          pendingBuffer += chunk.toString("utf8");
          if (pendingBuffer.length >= QUOTA_DETECTION_BUFFER_BYTES) {
            flushPendingBuffer();
          }
        });

        child.stderr?.on("data", (chunk) => {
          stderrTail = (stderrTail + chunk.toString("utf8")).slice(-2000);
          log?.debug?.("AUGGIE", `stderr: ${chunk.toString("utf8").slice(0, 200)}`);
        });

        child.on("close", (code) => {
          if (finished) return;
          if (code !== 0) {
            emitError(
              isCliNotFoundText(stderrTail)
                ? cliNotFoundMessage(auggieBin)
                : sanitizeErrorMessage(`Auggie CLI exited with code ${code}${stderrTail ? `: ${stderrTail}` : ""}`)
            );
            return;
          }
          flushPendingBuffer();
          if (quotaDetected || finished) return;
          emitStop();
        });
      },
      cancel() {},
    });

    return new Response(sseStream, {
      status: 200,
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  }

  runNonStreaming(auggieBin, model, promptText, signal, log) {
    return new Promise((resolve) => {
      let child;
      try {
        child = this.spawnAuggie(auggieBin, model, promptText);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        resolve(
          errorResponse(
            502,
            isEnoentLike(message) ? cliNotFoundMessage(auggieBin) : sanitizeErrorMessage(message)
          )
        );
        return;
      }

      let stdout = "";
      let stderrTail = "";
      let settled = false;

      const settle = (response) => {
        if (settled) return;
        settled = true;
        resolve(response);
      };

      if (signal) {
        signal.addEventListener("abort", () => {
          if (!child.killed) child.kill("SIGTERM");
          settle(errorResponse(502, sanitizeErrorMessage("Auggie CLI request aborted")));
        });
      }

      child.stdout?.on("data", (chunk) => {
        stdout += chunk.toString("utf8");
      });
      child.stderr?.on("data", (chunk) => {
        stderrTail = (stderrTail + chunk.toString("utf8")).slice(-2000);
        log?.debug?.("AUGGIE", `stderr: ${chunk.toString("utf8").slice(0, 200)}`);
      });

      child.on("error", (err) => {
        const message = err?.message || String(err);
        settle(
          errorResponse(
            502,
            isEnoentLike(message) ? cliNotFoundMessage(auggieBin) : sanitizeErrorMessage(message)
          )
        );
      });

      child.on("close", (code) => {
        if (code !== 0) {
          settle(
            errorResponse(
              502,
              isCliNotFoundText(stderrTail)
                ? cliNotFoundMessage(auggieBin)
                : sanitizeErrorMessage(`Auggie CLI exited with code ${code}${stderrTail ? `: ${stderrTail}` : ""}`)
            )
          );
          return;
        }
        if (isAuggieQuotaExhaustedText(stdout)) {
          settle(buildAuggieQuotaErrorResponse(stdout.trim()));
          return;
        }
        settle(buildChatCompletionResponse(model, stdout));
      });
    });
  }
}

function buildChatCompletionResponse(model, content) {
  const trimmed = content.trim();
  return new Response(
    JSON.stringify({
      id: `chatcmpl-auggie-${Date.now()}`,
      object: "chat.completion",
      created: Math.floor(Date.now() / 1000),
      model,
      choices: [
        {
          index: 0,
          message: { role: "assistant", content: trimmed },
          finish_reason: "stop",
        },
      ],
      usage: { prompt_tokens: 0, completion_tokens: Math.ceil(trimmed.length / 4), total_tokens: 0 },
    }),
    { status: 200, headers: { "Content-Type": "application/json" } }
  );
}

export default AuggieExecutor;
