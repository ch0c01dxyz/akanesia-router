export default {
  id: "gitlab",
  hidden: true,
  priority: 100,
  // "gitlab-duo" adalah ID provider ini di OmniRoute (alias "gld") —
  // digabung ke sini karena keduanya adalah layanan GitLab Duo yang sama.
  aliases: ["gitlab-duo", "gld"],
  display: {
    name: "GitLab Duo",
    icon: "code",
    color: "#FC6D26",
    textIcon: "GL",
    website: "https://gitlab.com",
    notice: {
      signupUrl: "https://gitlab.com",
    },
  },
  category: "oauth",
  transport: {
    baseUrl: "https://gitlab.com/api/v4/chat/completions",
    auth: {
      combined: true,
      header: "Authorization",
      scheme: "bearer",
    },
  },
  oauth: {
    defaultBaseUrl: "https://gitlab.com",
    authorizeUrlPath: "/oauth/authorize",
    tokenUrlPath: "/oauth/token",
    userInfoUrlPath: "/api/v4/user",
    scope: "api read_user",
    codeChallengeMethod: "S256",
  },
  // Model diambil dari entri "gitlab-duo" di OmniRoute (satu-satunya
  // definisi GitLab Duo di sana).
  models: [
    {
      id: "claude-sonnet-4-6",
      name: "Claude Sonnet 4.6 (GitLab Duo)",
      supportsReasoning: true,
      supportedThinkingEfforts: ["low", "medium", "high", "max"],
    },
    { id: "claude-haiku-4-5", name: "Claude Haiku 4.5 (GitLab Duo)" },
  ],
};
