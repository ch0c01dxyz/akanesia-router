// PromptQlExecutor — prompt.ql.app playground agent (Unofficial/Experimental).
// Ported from OmniRoute executors/promptql.ts.
//
// Reverse-engineered from the SPA:
//   - Mutations start_thread / send_thread_message only return UserMessage
//   - AI output is AgentMessage rows on thread_events (Hasura stream or poll)
//   - Auth: Bearer JWT (Hasura enrich-token) + projectId claim
//   - Models: FetchLlmConfigs; optional llmConfigId on start_thread (String!)
//   - Credits: promptql_project_credit_summary on data.pro.ql.app (usage leaf)
//
// OpenAI multi-turn is preserved via sticky PromptQL thread_id:
//   - Prefer body.promptql_thread_id / X-PromptQL-Thread-Id from the client
//   - Else history-prefix fingerprint (full user+assistant before last user)
//   - First turn always start_thread (never first-user-only sticky — that
//     collided across SkillsManager/agent sessions and routed follow-ups to
//     older chats)
// Response always echoes X-PromptQL-Thread-Id + promptql_thread_id.
//
// Token refresh (POST auth.pro.ql.app/ddn/project/token with session cookies)
// is implemented best-effort and still needs production verification.
import { BaseExecutor } from "./base.js";
import {
  PROMPTQL_FALLBACK_MODELS,
  clientFacingPromptQlModelId,
  resolvePromptQlModel,
} from "./promptql/models.js";
import {
  normalizePromptQlToken,
  extractProjectIdFromToken,
  isPlaygroundPromptQlToken,
  isDdnProjectPromptQlToken,
  isJwtExpired,
  resolvePromptQlCredentials,
} from "./promptql/jwt.js";
import {
  extractMessageText,
  extractMessageTextFromMessage,
  isUserLikeRole,
} from "./promptql/messageText.js";
import { extractFinalResponseMessage, isFinalAgentEvent, eventKind } from "./promptql/eventTree.js";
import {
  readClientThreadId,
  resolvePromptQlThreadBinding,
  storePromptQlThreadAfterTurn,
} from "./promptql/threadSticky.js";

function sanitizeErrorMessage(msg) {
  return String(msg || "").replace(/[\r\n]+/g, " ").slice(0, 2000);
}

function makeErrorResult(status, message, body, url) {
  return {
    response: new Response(
      JSON.stringify({
        error: {
          message: sanitizeErrorMessage(message),
          type: "upstream_error",
          code: `HTTP_${status}`,
        },
      }),
      { status, headers: { "Content-Type": "application/json" } }
    ),
    url,
    headers: {},
    transformedBody: body,
  };
}

// ─── Constants ──────────────────────────────────────────────────────────────

const PLAYGROUND_GQL =
  process.env.PROMPTQL_GRAPHQL_ENDPOINT ||
  "https://data.prompt.ql.app/promptql/playground-v2-hge/v1/graphql";
const CREDITS_GQL =
  process.env.PROMPTQL_CREDITS_ENDPOINT || "https://data.pro.ql.app/v1/graphql";
const TOKEN_REFRESH_URL =
  process.env.PROMPTQL_TOKEN_REFRESH_URL || "https://auth.pro.ql.app/ddn/project/token";
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36";
const POLL_INTERVAL_MS = 1200;
const POLL_TIMEOUT_MS = Number(process.env.PROMPTQL_POLL_TIMEOUT_MS || 180_000);

// ─── GraphQL documents ──────────────────────────────────────────────────────

const START_THREAD_WITH_MODEL = `
mutation StartThreadWithModel(
  $message: String!
  $projectId: String!
  $timezone: String!
  $llmConfigId: String!
  $uploads: [UserUploadInput!]
  $agentResponseConfig: String
) {
  start_thread(
    message: $message
    projectId: $projectId
    timezone: $timezone
    llmConfigId: $llmConfigId
    roomless: true
    uploads: $uploads
    agentResponseConfig: $agentResponseConfig
  ) {
    thread_id
    title
    created_at
    thread_events { thread_event_id created_at event_data }
  }
}`;

const START_THREAD_ROOMLESS = `
mutation StartThreadRoomless(
  $message: String!
  $projectId: String!
  $timezone: String!
  $uploads: [UserUploadInput!]
  $agentResponseConfig: String
) {
  start_thread(
    message: $message
    projectId: $projectId
    timezone: $timezone
    roomless: true
    uploads: $uploads
    agentResponseConfig: $agentResponseConfig
  ) {
    thread_id
    title
    created_at
    thread_events { thread_event_id created_at event_data }
  }
}`;

const SEND_THREAD_MESSAGE = `
mutation SendThreadMessage(
  $message: String!
  $timezone: String!
  $threadId: String!
  $uploads: [UserUploadInput!]
  $agentResponseConfig: String
) {
  send_thread_message(
    threadId: $threadId
    timezone: $timezone
    message: $message
    uploads: $uploads
    agentResponseConfig: $agentResponseConfig
  ) {
    thread_event_id
    event_data
    created_at
  }
}`;

const QUERY_THREAD_EVENTS = `
query QueryThreadEvents($thread_id: uuid!, $after_event_id: bigint!) {
  thread_events(
    where: {
      thread_id: {_eq: $thread_id}
      thread_event_id: {_gt: $after_event_id}
    }
    order_by: {thread_event_id: asc}
  ) {
    thread_event_id
    thread_id
    event_data
    created_at
    user_id
  }
}`;

function lastUserText(messages) {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (isUserLikeRole(messages[i]?.role || "")) {
      return extractMessageTextFromMessage(messages[i]).trim();
    }
  }
  return "";
}

function withAgentMention(text) {
  if (!text) return "<agent_mention /> ";
  if (text.includes("<agent_mention")) return text;
  return `<agent_mention /> ${text}`;
}

// ─── GraphQL client ─────────────────────────────────────────────────────────

function readStr(v) {
  if (typeof v !== "string") return "";
  const t = v.trim();
  return t.length ? t : "";
}

async function gql(endpoint, token, query, variables, operationName, signal) {
  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
      origin: "https://prompt.ql.app",
      referer: "https://prompt.ql.app/",
      "user-agent": USER_AGENT,
    },
    body: JSON.stringify({ query, variables, operationName }),
    signal: signal ?? undefined,
  });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`Non-JSON GraphQL HTTP ${res.status}: ${text.slice(0, 300)}`);
  }
  if (!res.ok) {
    throw new Error(`GraphQL HTTP ${res.status}: ${text.slice(0, 400)}`);
  }
  if (json.errors?.length) {
    throw new Error(json.errors.map((e) => e.message || "error").join("; "));
  }
  return json.data;
}

/**
 * Best-effort JWT refresh. Requires browser session cookies (credentials: include
 * in the SPA). Headless callers must store those cookies in providerSpecificData.cookie.
 * **Not fully verified in production** — see PR notes.
 */
export async function tryRefreshPromptQlToken(opts) {
  if (!opts.cookie || !opts.projectId) return null;
  try {
    const res = await fetch(TOKEN_REFRESH_URL, {
      method: "POST",
      headers: {
        accept: "*/*",
        "x-hasura-project-id": opts.projectId,
        origin: "https://prompt.ql.app",
        referer: "https://prompt.ql.app/",
        cookie: opts.cookie,
        "user-agent": USER_AGENT,
      },
      signal: opts.signal ?? undefined,
    });
    if (!res.ok) return null;
    const text = await res.text();
    // Response may be raw JWT or JSON { token / accessToken / ... }
    const trimmed = text.trim();
    if (trimmed.startsWith("eyJ")) return normalizePromptQlToken(trimmed.replace(/^"|"$/g, ""));
    try {
      const j = JSON.parse(trimmed);
      const t =
        readStr(j.token) ||
        readStr(j.accessToken) ||
        readStr(j.access_token) ||
        readStr(j.jwt);
      return t ? normalizePromptQlToken(t) : null;
    } catch {
      return null;
    }
  } catch {
    return null;
  }
}

// ─── OpenAI response helpers ────────────────────────────────────────────────

function estimateUsage(messages, content) {
  const prompt = (messages || [])
    .map((m) => extractMessageText(m.content))
    .join("\n");
  const prompt_tokens = Math.max(1, Math.ceil(prompt.length / 4));
  const completion_tokens = Math.max(1, Math.ceil(content.length / 4));
  return {
    prompt_tokens,
    completion_tokens,
    total_tokens: prompt_tokens + completion_tokens,
    estimated: true,
  };
}

function chatCompletionResponse(content, model, messages, threadId) {
  const id = threadId ? `chatcmpl-pql-${threadId}` : `chatcmpl-pql-${Date.now()}`;
  return new Response(
    JSON.stringify({
      id,
      object: "chat.completion",
      created: Math.floor(Date.now() / 1000),
      model,
      choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop" }],
      usage: estimateUsage(messages, content),
      promptql_thread_id: threadId || undefined,
    }),
    {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        ...(threadId ? { "X-PromptQL-Thread-Id": threadId } : {}),
      },
    }
  );
}

function pseudoStreamResponse(content, model, threadId) {
  const encoder = new TextEncoder();
  const id = threadId ? `chatcmpl-pql-${threadId}` : `chatcmpl-pql-${Date.now()}`;
  const chunk = (delta, finishReason) => ({
    id,
    object: "chat.completion.chunk",
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [{ index: 0, delta: delta ? { content: delta } : {}, finish_reason: finishReason }],
  });
  const readable = new ReadableStream({
    start(controller) {
      // Emit in ~word-ish slices for slightly better TTFT UX without true token stream
      const parts = content.match(/\S+\s*/g) || [content];
      let buf = "";
      for (const p of parts) {
        buf += p;
        if (buf.length >= 40) {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(chunk(buf, null))}\n\n`));
          buf = "";
        }
      }
      if (buf) controller.enqueue(encoder.encode(`data: ${JSON.stringify(chunk(buf, null))}\n\n`));
      controller.enqueue(encoder.encode(`data: ${JSON.stringify(chunk("", "stop"))}\n\n`));
      controller.enqueue(encoder.encode("data: [DONE]\n\n"));
      controller.close();
    },
  });
  return new Response(readable, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      ...(threadId ? { "X-PromptQL-Thread-Id": threadId } : {}),
    },
  });
}

// ─── Poll assistant ─────────────────────────────────────────────────────────

export async function pollAssistantText(opts) {
  const timeoutMs = opts.timeoutMs ?? POLL_TIMEOUT_MS;
  const intervalMs = opts.intervalMs ?? POLL_INTERVAL_MS;
  const start = Date.now();
  let cursor = String(opts.afterEventId || "0");
  let best = "";
  let sawFinal = false;
  const collected = [];

  while (Date.now() - start < timeoutMs) {
    if (opts.signal?.aborted) throw new Error("aborted");
    const data = await gql(
      PLAYGROUND_GQL,
      opts.token,
      QUERY_THREAD_EVENTS,
      { thread_id: opts.threadId, after_event_id: cursor },
      "QueryThreadEvents",
      opts.signal
    );
    const batch = data.thread_events || [];
    for (const ev of batch) {
      collected.push(ev);
      cursor = String(ev.thread_event_id);
      if (eventKind(ev.event_data) !== "AgentMessage") continue;
      const msg = extractFinalResponseMessage(ev.event_data);
      if (msg) best = msg;
      if (isFinalAgentEvent(ev.event_data) && msg) {
        sawFinal = true;
      }
      // Strict stop: final_response_sent
      if (JSON.stringify(ev.event_data || {}).includes("final_response_sent") && best) {
        return { text: best, lastEventId: cursor, events: collected };
      }
    }
    if (sawFinal && best) {
      // one extra idle poll to catch trailing metadata
      await new Promise((r) => setTimeout(r, intervalMs));
      return { text: best, lastEventId: cursor, events: collected };
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }

  if (best) return { text: best, lastEventId: cursor, events: collected };
  throw new Error(
    `PromptQL stream timeout after ${timeoutMs}ms (thread ${opts.threadId}, events=${collected.length})`
  );
}

// ─── Executor ───────────────────────────────────────────────────────────────

export class PromptQlExecutor extends BaseExecutor {
  constructor() {
    super("promptql", {
      id: "promptql",
      baseUrl: PLAYGROUND_GQL,
    });
  }

  async execute(input) {
    const { model, body, stream: wantStream, credentials, signal } = input;
    const requestBody = body || {};
    let { token, projectId, cookie, timezone } = resolvePromptQlCredentials(credentials);

    if (!token) {
      return makeErrorResult(
        401,
        "Missing PromptQL Bearer JWT — paste the Authorization token from prompt.ql.app DevTools (Network → graphql on data.prompt.ql.app → Authorization: Bearer …). Use the enrich-token JWT (iss=enrich-token), not the DDN/project token.",
        body,
        PLAYGROUND_GQL
      );
    }

    // Best-effort refresh when JWT is near expiry and session cookie is present.
    if (isJwtExpired(token) && cookie && projectId) {
      const refreshed = await tryRefreshPromptQlToken({ projectId, cookie, signal });
      if (refreshed) token = refreshed;
    }

    if (!projectId) {
      projectId = extractProjectIdFromToken(token);
    }
    if (!projectId) {
      return makeErrorResult(
        400,
        "Missing projectId — set providerSpecificData.projectId, or use a playground JWT with x-hasura-project-id, or a DDN JWT whose aud is the project UUID",
        body,
        PLAYGROUND_GQL
      );
    }

    // DDN/lux tokens authenticate credits (data.pro.ql.app) but playground GraphQL
    // rejects them ("Authentication hook unauthorized"). Fail early with a clear fix.
    if (!isPlaygroundPromptQlToken(token) && isDdnProjectPromptQlToken(token)) {
      return makeErrorResult(
        401,
        "This JWT is a DDN/project token (works for Limits/credits only). For chat, open prompt.ql.app → F12 → Network → filter graphql on data.prompt.ql.app → copy Authorization Bearer JWT (iss=enrich-token, claims under https://promptql.hasura.io). Paste that JWT (without the Bearer prefix).",
        body,
        PLAYGROUND_GQL
      );
    }

    const messages = requestBody.messages || [];
    const userText = lastUserText(messages);
    if (!userText) {
      return makeErrorResult(400, "No user message found", body, PLAYGROUND_GQL);
    }

    const clientFacing = clientFacingPromptQlModelId(model || requestBody.model);
    const resolved = resolvePromptQlModel(model || requestBody.model);
    // Prefer live configId from fallback catalog; discovery map can be extended later
    const llmConfigId =
      resolved?.configId && !resolved.configId.startsWith("placeholder-")
        ? resolved.configId
        : undefined;

    const inboundHeaders =
      input.clientHeaders ??
      input.headers;
    const clientThreadId = readClientThreadId(requestBody, inboundHeaders ?? undefined);
    const binding = resolvePromptQlThreadBinding(projectId, messages, clientThreadId);

    let threadId = binding.threadId;
    let afterEventId = "0";
    const agentMessage = withAgentMention(userText);

    try {
      if (!binding.isFollowUp || !threadId) {
        // New PromptQL thread — never reuse first-user-only sticky from another chat
        let start;
        if (llmConfigId) {
          try {
            const data = await gql(
              PLAYGROUND_GQL,
              token,
              START_THREAD_WITH_MODEL,
              {
                message: agentMessage,
                projectId,
                timezone,
                llmConfigId,
                uploads: [],
                agentResponseConfig: "force_respond",
              },
              "StartThreadWithModel",
              signal
            );
            start = data.start_thread;
          } catch {
            const data = await gql(
              PLAYGROUND_GQL,
              token,
              START_THREAD_ROOMLESS,
              {
                message: agentMessage,
                projectId,
                timezone,
                uploads: [],
                agentResponseConfig: "force_respond",
              },
              "StartThreadRoomless",
              signal
            );
            start = data.start_thread;
          }
        } else {
          const data = await gql(
            PLAYGROUND_GQL,
            token,
            START_THREAD_ROOMLESS,
            {
              message: agentMessage,
              projectId,
              timezone,
              uploads: [],
              agentResponseConfig: "force_respond",
            },
            "StartThreadRoomless",
            signal
          );
          start = data.start_thread;
        }
        threadId = start.thread_id;
        const seed = start.thread_events || [];
        if (seed.length) {
          afterEventId = String(seed[seed.length - 1].thread_event_id);
        }
      } else {
        // Follow-up on existing thread — only the latest user turn
        try {
          const data = await gql(
            PLAYGROUND_GQL,
            token,
            SEND_THREAD_MESSAGE,
            {
              message: agentMessage,
              timezone,
              threadId,
              uploads: [],
              agentResponseConfig: "force_respond",
            },
            "SendThreadMessage",
            signal
          );
          afterEventId = String(data.send_thread_message.thread_event_id);
        } catch (sendErr) {
          // Stale client thread id / deleted thread → fall back to a fresh start.
          // IMPORTANT: do NOT match bare "400"/"invalid" — GraphQL validation errors
          // often include those words and would force a new thread every turn
          // (observed: every OpenAI multi-turn became start_thread instead of
          // send_thread_message like the live SPA send1/send2 captures).
          const sendMsg = sendErr instanceof Error ? sendErr.message : String(sendErr);
          const isDeadThread =
            /thread\s*(not\s*found|deleted|expired|unknown|invalid)/i.test(sendMsg) ||
            /unknown\s*thread|no such thread|thread_id/i.test(sendMsg) ||
            /\b404\b/.test(sendMsg);
          if (!isDeadThread) {
            throw sendErr;
          }
          const data = await gql(
            PLAYGROUND_GQL,
            token,
            START_THREAD_ROOMLESS,
            {
              message: agentMessage,
              projectId,
              timezone,
              uploads: [],
              agentResponseConfig: "force_respond",
            },
            "StartThreadRoomless",
            signal
          );
          threadId = data.start_thread.thread_id;
          const seed = data.start_thread.thread_events || [];
          afterEventId = seed.length
            ? String(seed[seed.length - 1].thread_event_id)
            : "0";
        }
      }

      const { text } = await pollAssistantText({
        token,
        threadId,
        afterEventId,
        signal,
      });

      if (!text) {
        return makeErrorResult(
          502,
          "PromptQL returned empty content",
          body,
          PLAYGROUND_GQL
        );
      }

      // Sticky for next OpenAI multi-turn request (prefix = this full history)
      storePromptQlThreadAfterTurn(projectId, messages, text, threadId);

      const response = wantStream
        ? pseudoStreamResponse(text, clientFacing, threadId)
        : chatCompletionResponse(text, clientFacing, messages, threadId);

      return {
        response,
        url: PLAYGROUND_GQL,
        headers: { Authorization: "Bearer ***" },
        transformedBody: {
          threadId,
          projectId,
          model: clientFacing,
          llmConfigId: llmConfigId || null,
        },
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const status =
        /JWT|expired|unauthorized|401/i.test(msg) ? 401 : /timeout/i.test(msg) ? 504 : 502;
      return makeErrorResult(status, `PromptQL: ${msg}`, body, PLAYGROUND_GQL);
    }
  }
}

// Re-export catalog for tests / registry
export { PROMPTQL_FALLBACK_MODELS, PLAYGROUND_GQL, CREDITS_GQL, TOKEN_REFRESH_URL };

// Re-export the full pre-split public surface so external/test consumers keep
// working unchanged.
export {
  decodeJwtPayload,
  looksLikeUuid,
  normalizePromptQlToken,
  extractProjectIdFromToken,
  isPlaygroundPromptQlToken,
  isDdnProjectPromptQlToken,
  issuerHostIsTrusted,
  isJwtExpired,
  resolvePromptQlCredentials,
} from "./promptql/jwt.js";
export {
  extractMessageText,
  extractMessageTextFromMessage,
  extractToolCallsText,
  isUserLikeRole,
} from "./promptql/messageText.js";
export {
  walkStrings,
  extractFinalResponseMessage,
  isFinalAgentEvent,
  eventKind,
} from "./promptql/eventTree.js";
export {
  normalizeForFingerprint,
  extractToolNameSignature,
  conversationFingerprint,
  lastAssistantStickyKeys,
  lastAssistantFingerprint,
  historyPrefixBeforeLastUser,
  hasAssistantMessage,
  clearPromptQlThreadBindingsForTests,
  readClientThreadId,
  resolvePromptQlThreadBinding,
  storePromptQlThreadAfterTurn,
} from "./promptql/threadSticky.js";

export default PromptQlExecutor;
