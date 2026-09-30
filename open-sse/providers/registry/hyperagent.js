// hyperagent — HyperAgent (hyperagent.com) agent chat via unofficial reverse-engineered web session (OmniRoute: hyperagent).
// Chat: POST /api/threads/{id}/chat (SSE). Model is applied on the thread via PATCH. Auth: browser Cookie header.
export default {
  id: "hyperagent",
  alias: "ha",
  display: {
    name: "HyperAgent",
    icon: "bolt",
    color: "#F59E0B",
    textIcon: "HA",
    website: "https://hyperagent.com",
    notice: {
      text: "Paste the full Cookie header from hyperagent.com (DevTools → Network → any document request → Request Headers → Cookie) as the credential.",
    },
  },
  category: "webCookie",
  authType: "cookie",
  authModes: ["cookie"],
  transport: {
    baseUrl: "https://hyperagent.com/api/threads",
    format: "openai",
    authHeader: "cookie",
  },
  passthroughModels: true,
  models: [
    { id: "fable-latest", name: "Fable 5", contextLength: 1000000 },
    { id: "claude-fable-5", name: "Claude Fable 5", contextLength: 1000000 },
    { id: "opus-latest", name: "Claude Opus Latest", contextLength: 1000000 },
    { id: "claude-opus-4-8", name: "Claude Opus 4.8", contextLength: 1000000 },
    { id: "sonnet-latest", name: "Claude Sonnet Latest", contextLength: 1000000 },
    { id: "claude-sonnet-5", name: "Claude Sonnet 5", contextLength: 1000000 },
  ],
};
