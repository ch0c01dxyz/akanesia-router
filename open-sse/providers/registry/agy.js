// agy — Antigravity CLI surface (OmniRoute: agy). Reuses the antigravity executor/translator
// (identical backend); CLI client profile (User-Agent) + CLI model catalog.
import { ANTIGRAVITY_OAUTH_CLIENT } from "../shared.js";

const AGY_CLI_USER_AGENT = "antigravity/cli/1.1.5 (aidev_client; os_type=darwin; arch=arm64; auth_method=consumer)";

export default {
  id: "agy",
  priority: 20,
  alias: "agy",
  uiAlias: "agy",
  display: {
    name: "Agy",
    icon: "terminal",
    color: "#F59E0B",
    website: "https://antigravity.google",
    textIcon: "AG",
  },
  category: "oauth",
  authType: "oauth",
  hasOAuth: true,
  serviceKinds: ["llm"],
  transport: {
    baseUrls: [
      "https://daily-cloudcode-pa.googleapis.com",
      "https://cloudcode-pa.googleapis.com",
    ],
    format: "antigravity",
    headers: {
      "User-Agent": AGY_CLI_USER_AGENT,
    },
    retry: { "429": { attempts: 3 }, "500": { attempts: 3 }, "503": { attempts: 3 } },
    clientId: ANTIGRAVITY_OAUTH_CLIENT.clientId,
    clientSecret: ANTIGRAVITY_OAUTH_CLIENT.clientSecret,
  },
  models: [
    { id: "gemini-3.7-flash-high", name: "Gemini 3.7 Flash (High)", contextLength: 1048576, maxOutputTokens: 65536, supportsReasoning: true, supportsVision: true, toolCalling: true },
    { id: "gemini-3.7-flash-medium", name: "Gemini 3.7 Flash (Medium)", contextLength: 1048576, maxOutputTokens: 65536, supportsReasoning: true, supportsVision: true, toolCalling: true },
    { id: "gemini-3.7-flash-low", name: "Gemini 3.7 Flash (Low)", contextLength: 1048576, maxOutputTokens: 65536, supportsReasoning: true, supportsVision: true, toolCalling: true },
    { id: "gemini-3.7-flash-tiered", name: "Gemini 3.7 Flash (Tiered)", contextLength: 1048576, maxOutputTokens: 65536, supportsReasoning: true, supportsVision: true, toolCalling: true },
    { id: "gemini-3.8-flash-high", name: "Gemini 3.8 Flash (High)", contextLength: 1048576, maxOutputTokens: 65536, supportsReasoning: true, supportsVision: true, toolCalling: true },
    { id: "gemini-3.8-flash-medium", name: "Gemini 3.8 Flash (Medium)", contextLength: 1048576, maxOutputTokens: 65536, supportsReasoning: true, supportsVision: true, toolCalling: true },
    { id: "gemini-3.8-flash-low", name: "Gemini 3.8 Flash (Low)", contextLength: 1048576, maxOutputTokens: 65536, supportsReasoning: true, supportsVision: true, toolCalling: true },
    { id: "gemini-pro-agent", name: "Gemini 3.1 Pro (High)", contextLength: 1048576, maxOutputTokens: 65535, supportsReasoning: true, supportsVision: true, toolCalling: true },
    { id: "gemini-3.1-pro-low", name: "Gemini 3.1 Pro (Low)", contextLength: 1048576, maxOutputTokens: 65535, supportsReasoning: true, supportsVision: true, toolCalling: true },
    { id: "gemini-3.1-flash-lite", name: "Gemini 3.1 Flash Lite", contextLength: 1048576, maxOutputTokens: 65535, toolCalling: true },
    { id: "claude-opus-4-6-thinking", name: "Claude Opus 4.6 (Thinking)", contextLength: 1048576, maxOutputTokens: 65536, supportsReasoning: true, supportsVision: true, toolCalling: true },
    { id: "claude-sonnet-4-6", name: "Claude Sonnet 4.6 (Thinking)", contextLength: 1048576, maxOutputTokens: 65536, supportsReasoning: true, supportsVision: true, toolCalling: true },
    { id: "gpt-oss-120b-medium", name: "GPT-OSS 120B (Medium)", contextLength: 131072, maxOutputTokens: 32768, supportsReasoning: true, toolCalling: true },
  ],
  passthroughModels: true,
  oauth: {
    authorizeUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    tokenUrl: "https://oauth2.googleapis.com/token",
    userInfoUrl: "https://www.googleapis.com/oauth2/v1/userinfo",
    scopes: [
      "https://www.googleapis.com/auth/cloud-platform",
      "https://www.googleapis.com/auth/userinfo.email",
      "https://www.googleapis.com/auth/userinfo.profile",
      "https://www.googleapis.com/auth/cclog",
      "https://www.googleapis.com/auth/experimentsandconfigs",
    ],
    apiEndpoint: "https://daily-cloudcode-pa.googleapis.com",
    apiVersion: "v1internal",
    loadCodeAssistEndpoint: "https://cloudcode-pa.googleapis.com/v1internal:loadCodeAssist",
    onboardUserEndpoint: "https://cloudcode-pa.googleapis.com/v1internal:onboardUser",
    loadCodeAssistUserAgent: AGY_CLI_USER_AGENT,
    refreshLeadMs: 300000,
  },
  features: { usage: true },
};
