import { CLAUDE_API_HEADERS } from "../shared.js";

// Kimi Code subscription credentials (OAuth or Code API key).
// Moonshot platform keys belong to the separate moonshot provider.
// CLIProxyAPI parity: client_id, auth.kimi.com device+token, X-Msh-* headers, device_id.
export default {
  id: "kimi",
  priority: 170,
  alias: "kimi",
  // Legacy id + short alias from former kimi-coding registry entry
  aliases: ["kimi-coding", "kmc"],
  display: {
    name: "Kimi",
    icon: "psychology",
    color: "#1E3A8A",
    textIcon: "KM",
    website: "https://www.kimi.com/code",
    notice: {
      apiKeyUrl: "https://www.kimi.com/code/console",
      signupUrl: "https://www.kimi.com/code",
    },
  },
  category: "oauth",
  authModes: ["oauth", "apikey"],
  hasOAuth: true,
  transport: {
    baseUrl: "https://api.kimi.ai/coding/v1/messages",
    format: "claude",
    headers: { ...CLAUDE_API_HEADERS },
    clientId: "17e5f671-d194-4dfb-9706-5516cb48c098",
    tokenUrl: "https://auth.kimi.com/api/oauth/token",
    refreshUrl: "https://auth.kimi.com/api/oauth/token",
    auth: {
      combined: true,
      header: "x-api-key",
      scheme: "raw",
      hooks: ["kimiHeaders"],
    },
  },
  // Multi-endpoint: pick the transport matching client sourceFormat to skip translation.
  transports: [
    {
      format: "openai",
      baseUrl: "https://api.kimi.ai/coding/v1/chat/completions",
      auth: { combined: true, header: "Authorization", scheme: "bearer", hooks: ["kimiHeaders"] },
    },
    {
      format: "claude",
      baseUrl: "https://api.kimi.ai/coding/v1/messages",
      headers: { ...CLAUDE_API_HEADERS },
      auth: { combined: true, header: "x-api-key", scheme: "raw", hooks: ["kimiHeaders"] },
    },
    // Kimi Code melayani OpenAI Responses API secara native (Codex wire_api = "responses").
    {
      format: "openai-responses",
      baseUrl: "https://api.kimi.ai/coding/v1/responses",
      auth: { combined: true, header: "Authorization", scheme: "bearer", hooks: ["kimiHeaders"] },
    },
  ],
  models: [
    // Official Code catalog, verified against GET /coding/v1/models.
    { id: "k3.1-pro", name: "Kimi K3.1 Pro" },
    { id: "k3.1-pro-highspeed", name: "Kimi K3.1 Pro Highspeed" },
    { id: "k3", name: "Kimi K3" },
    { id: "k3-256k", name: "Kimi K3 (256K)" },
    { id: "kimi-for-coding", name: "Kimi K2.8 Preview" },
    { id: "kimi-for-coding-highspeed", name: "Kimi K2.7 Code Highspeed" },
    // Existing combos keep working without sending undocumented platform IDs.
    { id: "kimi-k3", name: "Kimi K3 (legacy alias)", upstreamModelId: "k3" },
    { id: "kimi-k2.7-code", name: "Kimi for Coding (legacy alias)", upstreamModelId: "kimi-for-coding" },
    { id: "kimi-k2.7-code-highspeed", name: "Kimi Highspeed (legacy alias)", upstreamModelId: "kimi-for-coding-highspeed" },
  ],
  serviceKinds: ["llm", "webSearch"],
  searchViaChat: {
    defaultModel: "k3.1-pro",
    endpoint: "https://api.kimi.ai/coding/v1/responses",
    pricingUrl: "https://www.kimi.com/code/docs/en/kimi-code/membership.html",
  },
  oauth: {
    clientId: "17e5f671-d194-4dfb-9706-5516cb48c098",
    deviceCodeUrl: "https://auth.kimi.com/api/oauth/device_authorization",
    tokenUrl: "https://auth.kimi.com/api/oauth/token",
    refreshUrl: "https://auth.kimi.com/api/oauth/token",
    // CLIProxyAPI refreshThresholdSeconds = 300
    refreshLeadMs: 300000,
    authorizeDeviceUrl: "https://www.kimi.com/code/authorize_device",
  },
  features: {
    usage: true,
    // API-key connections also hit /v1/usages (x-api-key) — need usageApikey
    // so isUsageEligible + /api/usage allow non-oauth authType.
    usageApikey: true,
  },
};
