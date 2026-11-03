import { handleChat } from "@/sse/handlers/chat.js";
import { initTranslators } from "open-sse/translator/index.js";

let initialized = false;
const ERROR_TYPES = {
  401: "authentication_error", 402: "billing_error", 403: "permission_error",
  404: "not_found_error", 409: "conflict_error", 413: "request_too_large",
  429: "rate_limit_error", 504: "timeout_error", 529: "overloaded_error",
};

/**
 * Initialize translators once
 */
async function ensureInitialized() {
  if (!initialized) {
    await initTranslators();
    initialized = true;
  }
}

/**
 * Handle CORS preflight
 */
export async function OPTIONS() {
  return new Response(null, {
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "*"
    }
  });
}

/**
 * POST /v1/messages - Claude format (auto convert via handleChat)
 */
export async function POST(request) {
  await ensureInitialized();
  const response = await handleChat(request);
  if (response.status < 400 || !response.headers.get("content-type")?.includes("application/json")) return response;
  const body = await response.json();
  const headers = new Headers(response.headers);
  headers.delete("content-length");
  return Response.json({
    type: "error",
    error: {
      type: ERROR_TYPES[response.status] || (response.status >= 500 ? "api_error" : "invalid_request_error"),
      message: body.error?.message || (typeof body.error === "string" ? body.error : "Request failed"),
    },
    request_id: body.request_id || headers.get("request-id") || null,
  }, { status: response.status, headers });
}

