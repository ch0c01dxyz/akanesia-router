// copilot-m365-web — Microsoft 365 Copilot BizChat via the Substrate
// WebSocket protocol (OmniRoute: copilot-m365-web).
// Opens wss://substrate.office.com/m365Copilot/Chathub/<oid>@<tenant> with the
// access_token in the WS query string; SignalR handshake, then a type:4 "chat"
// invocation + type:1 "Metrics" frame in one socket write. Auth: the credential
// is NOT a cookie — paste `access_token=<JWT>` and `chathubPath=<oid>@<tenant>`
// from the Chathub WebSocket Request URL in DevTools (m365.cloud.microsoft/chat).
export default {
  id: "copilot-m365-web",
  alias: "m365copilot",
  display: {
    name: "M365 Copilot (Web)",
    icon: "smart_toy",
    color: "#0078D4",
    textIcon: "M365",
    website: "https://m365.cloud.microsoft/chat",
    notice: {
      text: "The credential is not a cookie. Paste access_token=<JWT> and chathubPath=<user-oid>@<tenant-id> from the Chathub WebSocket Request URL in DevTools on m365.cloud.microsoft/chat.",
      signupUrl: "https://m365.cloud.microsoft/chat",
    },
  },
  category: "webCookie",
  authType: "cookie",
  authModes: ["cookie"],
  transport: {
    baseUrl: "wss://substrate.office.com/m365Copilot/Chathub",
    format: "openai",
    authHeader: "cookie",
  },
  models: [
    { id: "copilot-m365", name: "Microsoft 365 Copilot (BizChat)", toolCalling: false },
    { id: "copilot-m365-claude-opus", name: "Microsoft 365 Copilot — Claude Opus", toolCalling: false },
    {
      id: "copilot-m365-gpt-5-6-reasoning",
      name: "Microsoft 365 Copilot — GPT 5.6 Reasoning",
      toolCalling: false,
    },
    { id: "copilot-m365-gpt-5-5-chat", name: "Microsoft 365 Copilot — GPT 5.5 Chat", toolCalling: false },
  ],
};
