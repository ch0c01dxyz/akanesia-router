// ChatGptWebCodexExecutor — native /v1/responses Codex requests against ChatGPT
// web sessions (ported from OmniRoute's chatgpt-web-codex executor).
//
// PORTABLE PARTS (preserved, all pure):
//   - Model route table: luna/think/instant/medium/high/extra-high/pro → backend
//     model (gpt-5.6-luna | gpt-5.6-sol), effort (low|medium|high|xhigh|max), and
//     pro/sol availability flags — `requireChatGptWebCodexRoute`.
//   - Reasoning effort extraction from the native body — `reasoningEffortOf`
//     (with the source's "ultra" → "max" normalization at call time).
//   - Credential secret codec (JSON bundle: browser cookie OR verified browser
//     storage state + optional runtime key) — `encode/decodeChatGptWebCodexSecrets`.
//   - Chrome executable detection — `detectChromeExecutable` (deps-injectable).
//   - Native-request validation helpers: `inputHasSelfContainedCodexContinuation`
//     and `resolveChatGptWebCodexPreviousResponse` (previous_response_id binding).
//   - Embedded browser storage-state validation reuses
//     `normalizeChatGptWebStorageState` from ./chatgpt-web.js.
//
// GAP (stubbed, same as chatgpt-web.js): OmniRoute drives the turn through its
// vendored browser worker — ChatGptBrowserWorker + chatgpt-web adapter,
// browser-login storage state, the Responses parser/state/bridge
// (parseRequest/expandPreviousResponseInput/rememberResponseState,
// bridgeToResponsesSSE/buildResponseJSON), the tunnel runtime for tool calls,
// and Codex client identity verification (codexIdentity.ts) — none of which has
// a 9router equivalent and which requires Playwright (not installed). Worse,
// 9router's chatCore does not pass `clientResponseFormat`, `clientHeaders`, or
// `onCredentialsRefreshed` into the executor input, so even the native-request
// verification gate can't run faithfully. execute() therefore validates
// everything portable and returns a clear error for the turn itself instead of
// pretending browser execution works.
// Deps seam: { validateNativeCodexRequest, expandPreviousResponseInput,
// extractTurnIdentity, runCodexTurn, id, now, env, exists }.
import { existsSync } from "node:fs";
import { BaseExecutor } from "./base.js";
import { normalizeChatGptWebStorageState } from "./chatgpt-web.js";

const CHATGPT_WEB_CODEX_PAGE_URL = "https://chatgpt.com/?temporary-chat=true";

/** Effort levels the web adapter understands (port of ChatGptWebCodexEffort). */
const EFFORTS = new Set(["low", "medium", "high", "xhigh", "max"]);

// Model routes — verbatim from OmniRoute's chatgpt-web-codex/models.ts.
// id → { backendModel, effort, pro, sol }.
const ROUTES = new Map([
  ["luna", { id: "luna", backendModel: "gpt-5.6-luna", effort: "low", pro: false, sol: false }],
  ["think", { id: "think", backendModel: "gpt-5.6-luna", effort: "medium", pro: false, sol: false }],
  ["instant", { id: "instant", backendModel: "gpt-5.6-sol", effort: "low", pro: false, sol: true }],
  ["medium", { id: "medium", backendModel: "gpt-5.6-sol", effort: "medium", pro: false, sol: true }],
  ["high", { id: "high", backendModel: "gpt-5.6-sol", effort: "high", pro: false, sol: true }],
  [
    "extra-high",
    { id: "extra-high", backendModel: "gpt-5.6-sol", effort: "xhigh", pro: true, sol: true },
  ],
  ["pro", { id: "pro", backendModel: "gpt-5.6-sol", effort: "max", pro: true, sol: true }],
]);

export function requireChatGptWebCodexRoute(model) {
  const normalized = String(model ?? "").replace(/^chatgpt-web-codex\//, "");
  const route = ROUTES.get(normalized);
  if (!route) throw new Error(`Unsupported ChatGPT Web (Codex) model: ${model}`);
  return route;
}

export function reasoningEffortOf(body) {
  const source = body && typeof body === "object" ? body : {};
  const reasoning = source.reasoning;
  if (reasoning && typeof reasoning === "object" && !Array.isArray(reasoning)) {
    const effort = reasoning.effort;
    return typeof effort === "string" ? effort : undefined;
  }
  const effort = source.reasoning_effort;
  return typeof effort === "string" ? effort : undefined;
}

const CODEX_SECRETS_VERSION = 2;

function normalizedCookie(value) {
  return String(value).trim().replace(/^cookie\s*:\s*/i, "");
}

export function encodeChatGptWebCodexSecrets(secrets) {
  const cookie = secrets?.cookie ? normalizedCookie(secrets.cookie) : "";
  const storageState = secrets?.storageState;
  if (!cookie && (!storageState || typeof storageState !== "object")) {
    throw new Error("ChatGPT Cookie or verified browser storage state is required");
  }
  return JSON.stringify({
    version: CODEX_SECRETS_VERSION,
    ...(storageState ? { storageState } : { cookie }),
    ...(secrets?.runtimeKey?.trim() ? { runtimeKey: secrets.runtimeKey.trim() } : {}),
  });
}

export function decodeChatGptWebCodexSecrets(value) {
  const trimmed = String(value ?? "").trim();
  if (!trimmed) throw new Error("ChatGPT Web (Codex) credentials are missing");
  try {
    const parsed = JSON.parse(trimmed);
    if (
      parsed &&
      typeof parsed === "object" &&
      parsed.version === CODEX_SECRETS_VERSION &&
      parsed.storageState &&
      typeof parsed.storageState === "object"
    ) {
      return {
        storageState: parsed.storageState,
        ...(typeof parsed.runtimeKey === "string" && parsed.runtimeKey.trim()
          ? { runtimeKey: parsed.runtimeKey.trim() }
          : {}),
      };
    }
    if (
      parsed &&
      typeof parsed === "object" &&
      (parsed.version === CODEX_SECRETS_VERSION || parsed.version === 1) &&
      typeof parsed.cookie === "string"
    ) {
      const cookie = normalizedCookie(parsed.cookie);
      if (!cookie) throw new Error("ChatGPT Cookie is missing");
      return {
        cookie,
        ...(typeof parsed.runtimeKey === "string" && parsed.runtimeKey.trim()
          ? { runtimeKey: parsed.runtimeKey.trim() }
          : {}),
      };
    }
  } catch (error) {
    if (error instanceof SyntaxError) return { cookie: normalizedCookie(trimmed) };
    throw error;
  }
  return { cookie: normalizedCookie(trimmed) };
}

export function detectChromeExecutable(explicit, deps = {}) {
  const env = deps.env ?? process.env;
  const exists = deps.exists ?? existsSync;
  const candidates = [
    explicit,
    env.CHATGPT_WEB_CODEX_CHROME_PATH,
    env.CHROME_PATH,
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  ];
  return candidates.find((candidate) =>
    Boolean(candidate && String(candidate).trim() && exists(String(candidate).trim()))
  );
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function itemType(value) {
  if (!isRecord(value)) return "";
  const type = value.type;
  return typeof type === "string" ? type : "";
}

function itemRole(value) {
  if (!isRecord(value)) return "";
  const role = value.role;
  return typeof role === "string" ? role : "";
}

/** Pure: does the native body already carry user + tool-output items (self-contained continuation)? */
export function inputHasSelfContainedCodexContinuation(body) {
  const input = Array.isArray(body?.input) ? body.input : [];
  let hasUser = false;
  let hasToolOutput = false;
  for (const item of input) {
    if (itemRole(item) === "user" || itemType(item) === "message") hasUser = true;
    if (itemType(item) === "function_call_output" || itemType(item) === "custom_tool_call_output") {
      hasToolOutput = true;
    }
  }
  return hasUser && hasToolOutput;
}

/**
 * Bind previous_response_id to this turn's response-state namespace.
 * Without the vendored state store the expansion is only possible through the
 * injected `deps.expandPreviousResponseInput`; otherwise a self-contained
 * continuation is accepted and anything else is rejected (409).
 */
export function resolveChatGptWebCodexPreviousResponse(body, namespace, deps = {}) {
  if (typeof body?.previous_response_id !== "string" || !body.previous_response_id.trim()) {
    return { body, ok: true };
  }
  if (deps.expandPreviousResponseInput) {
    const expanded = deps.expandPreviousResponseInput(body, namespace);
    if (expanded !== body) return { body: expanded, ok: true };
  }
  if (!inputHasSelfContainedCodexContinuation(body)) return { body, ok: false };
  const next = { ...body };
  delete next.previous_response_id;
  return { body: next, ok: true };
}

/** Strip the native-passthrough marker before forwarding the body (source nativeBody). */
export function stripNativePassthrough(body) {
  const copy = { ...(isRecord(body) ? body : {}) };
  delete copy._nativeCodexPassthrough;
  return copy;
}

/** Default browser-turn path: stubbed — OmniRoute's vendored Codex browser worker has no 9router equivalent. */
async function unavailableCodexTurn() {
  throw new Error(
    "ChatGPT Web (Codex) turn execution is unavailable in this build: it requires OmniRoute's " +
      "vendored browser worker (ChatGptBrowserWorker + chatgpt-web adapter, browser-login " +
      "storage state, Responses parser/state/bridge, tunnel runtime) and Playwright, none of " +
      "which is installed in 9router"
  );
}

function codexErrorResponse(status, message, code = "chatgpt_web_codex_error", body) {
  const clean = String(message ?? "")
    .replace(/[\r\n]+/g, " ")
    .slice(0, 2000);
  return {
    response: new Response(
      JSON.stringify({
        error: {
          message: clean,
          type: status >= 500 ? "provider_error" : "invalid_request_error",
          code,
        },
      }),
      { status, headers: { "Content-Type": "application/json" } }
    ),
    url: CHATGPT_WEB_CODEX_PAGE_URL,
    headers: {},
    transformedBody: body,
  };
}

export class ChatGptWebCodexExecutor extends BaseExecutor {
  constructor(deps = {}) {
    super("chatgpt-web-codex", { id: "chatgpt-web-codex", baseUrl: "https://chatgpt.com" });
    this.deps = deps;
  }

  async execute(input) {
    const nativeBody = stripNativePassthrough(input.body);
    try {
      // 1. Native passthrough gate: this provider only serves native /v1/responses
      // requests flagged with _nativeCodexPassthrough. 9router's chatCore does not
      // pass clientResponseFormat into the executor, so the format half of the
      // source gate is assumed from the body flag.
      if (!isRecord(input.body) || input.body._nativeCodexPassthrough !== true) {
        return codexErrorResponse(
          400,
          "ChatGPT Web (Codex) supports only native /v1/responses requests",
          "unsupported_endpoint",
          input.body
        );
      }

      // 2. Verified Codex client request: the source verifies the signature via
      // codexIdentity.ts against the original client headers — both are unavailable
      // in 9router's chatCore (no clientHeaders input). An injected validator may
      // approve; otherwise fail closed rather than pretending verification passed.
      const clientHeaders = input.clientHeaders ?? {};
      const isVerified = this.deps.validateNativeCodexRequest
        ? Boolean(this.deps.validateNativeCodexRequest(nativeBody, clientHeaders))
        : false;
      if (!isVerified) {
        return codexErrorResponse(
          400,
          "ChatGPT Web (Codex) requires a verified Codex client request with thread_id and turn_id; " +
            "verification needs OmniRoute's codexIdentity check and the original client headers, " +
            "which 9router's chatCore does not provide",
          "unverified_codex_client",
          input.body
        );
      }

      // 3. Connection credentials: connectionId + encoded secret bundle.
      const connectionId =
        typeof input.credentials?.connectionId === "string"
          ? input.credentials.connectionId.trim()
          : "";
      const encodedCredentials =
        typeof input.credentials?.apiKey === "string" ? input.credentials.apiKey.trim() : "";
      if (!connectionId || !encodedCredentials) {
        return codexErrorResponse(
          401,
          "ChatGPT Web (Codex) connection credentials are missing",
          "chatgpt_web_codex_error",
          input.body
        );
      }
      const secrets = decodeChatGptWebCodexSecrets(encodedCredentials);
      if (secrets.storageState) {
        // Reuse the established ChatGPT web storage-state validation.
        normalizeChatGptWebStorageState(secrets.storageState);
      }

      // 4. Model route + reasoning effort compatibility (both pure).
      const route = requireChatGptWebCodexRoute(input.model);
      const explicitEffort = reasoningEffortOf(nativeBody);
      const normalizedEffort =
        explicitEffort === "ultra" ? "max" : explicitEffort;
      if (normalizedEffort && normalizedEffort !== route.effort) {
        return codexErrorResponse(
          400,
          `Requested reasoning effort ${explicitEffort} is incompatible with model ${route.id}`,
          "incompatible_reasoning_effort",
          input.body
        );
      }
      if (normalizedEffort && !EFFORTS.has(normalizedEffort)) {
        return codexErrorResponse(
          400,
          `Unsupported reasoning effort ${explicitEffort} for ChatGPT Web (Codex)`,
          "incompatible_reasoning_effort",
          input.body
        );
      }

      // 5. previous_response_id binding. The namespace needs the turn identity
      // (thread_id/turn_id); without the vendored extractor, read them off the
      // native body (the only source available) or fail closed.
      const identity = this.deps.extractTurnIdentity
        ? this.deps.extractTurnIdentity(nativeBody)
        : { threadId: nativeBody.thread_id, turnId: nativeBody.turn_id };
      const threadId = typeof identity?.threadId === "string" ? identity.threadId.trim() : "";
      const turnId = typeof identity?.turnId === "string" ? identity.turnId.trim() : "";
      if (!threadId || !turnId) {
        return codexErrorResponse(
          400,
          "ChatGPT Web (Codex) requires a verified Codex client request with thread_id and turn_id",
          "unverified_codex_client",
          input.body
        );
      }
      const namespace = `${connectionId}:${threadId}:${turnId}`;
      const resolvedPrevious = resolveChatGptWebCodexPreviousResponse(
        nativeBody,
        namespace,
        this.deps
      );
      if (!resolvedPrevious.ok) {
        return codexErrorResponse(
          409,
          "previous_response_id does not belong to this verified Codex turn",
          "invalid_previous_response_binding",
          input.body
        );
      }

      // 6. Route availability flags from the connection's provider data.
      const providerData = isRecord(input.credentials?.providerSpecificData)
        ? input.credentials.providerSpecificData
        : {};
      const solAvailable = providerData.solAvailable !== false;
      const proAvailable = providerData.proAvailable === true;
      if (route.sol !== solAvailable) {
        return codexErrorResponse(
          400,
          route.sol
            ? "ChatGPT Sol models are not available for this Luna-only connection"
            : "ChatGPT Luna models are only available for Luna-only connections",
          "chatgpt_web_codex_error",
          input.body
        );
      }
      if (route.pro && !proAvailable) {
        return codexErrorResponse(
          400,
          `${route.id} is not available for this non-Pro connection`,
          "chatgpt_web_codex_error",
          input.body
        );
      }

      // 7. Chrome availability (portable check; the source throws when neither a
      // Chrome binary nor a CDP endpoint is configured).
      const cdpEndpoint =
        typeof providerData.browserCdpEndpoint === "string" && providerData.browserCdpEndpoint.trim()
          ? providerData.browserCdpEndpoint.trim()
          : (process.env.CHATGPT_WEB_CODEX_CDP_URL || "").trim();
      const chromeExecutablePath = detectChromeExecutable(
        typeof providerData.chromeExecutablePath === "string"
          ? providerData.chromeExecutablePath
          : undefined,
        this.deps
      );
      if (!chromeExecutablePath && !cdpEndpoint) {
        return codexErrorResponse(
          502,
          "No supported Chrome or Chromium executable was found (and no CHATGPT_WEB_CODEX_CDP_URL is configured)",
          "chatgpt_web_codex_error",
          input.body
        );
      }

      // 8. The turn itself: stubbed. A real backend must be injected as
      // deps.runCodexTurn({ body, route, connectionId, secrets, namespace, chromeExecutablePath, cdpEndpoint, signal })
      // and return a WHATWG Response in openai-responses format.
      const runCodexTurn = this.deps.runCodexTurn ?? unavailableCodexTurn;
      const turnResponse = await runCodexTurn({
        body: resolvedPrevious.body,
        route,
        connectionId,
        secrets,
        namespace,
        chromeExecutablePath,
        cdpEndpoint,
        signal: input.signal,
        log: input.log,
      });
      return {
        response: turnResponse,
        url: CHATGPT_WEB_CODEX_PAGE_URL,
        headers: {},
        transformedBody: resolvedPrevious.body,
      };
    } catch (error) {
      const message = String(error instanceof Error ? error.message : error || "");
      input.log?.warn?.("CHATGPT_WEB_CODEX", message.replace(/[\r\n]+/g, " ").slice(0, 2000));
      const status = /No supported Chrome|browser automation|vendored browser worker|turn execution is unavailable/i.test(
        message
      )
        ? 502
        : 400;
      return codexErrorResponse(
        status,
        message || "ChatGPT Web (Codex) executor error",
        "chatgpt_web_codex_error",
        input.body
      );
    }
  }
}

export default ChatGptWebCodexExecutor;
