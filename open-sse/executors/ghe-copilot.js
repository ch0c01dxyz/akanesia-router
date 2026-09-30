// GheCopilotExecutor — ported from OmniRoute's ghe-copilot executor.
//
// GitHub Enterprise Copilot: same Copilot protocol as github.com, but the chat
// endpoints live on the enterprise host (gheUrl) or the dynamic endpoints
// returned by the GHE copilot_internal token exchange. Extends GithubExecutor.
import { GithubExecutor } from "./github.js";
import { getModelTargetFormat } from "../config/providerModels.js";

export class GheCopilotExecutor extends GithubExecutor {
  constructor(provider = "ghe-copilot", config = null) {
    super(provider, {
      format: "openai",
      baseUrl: "https://api.githubcopilot.com/chat/completions",
      responsesBaseUrl: "https://api.githubcopilot.com/responses",
      // Static default only; getMessagesBase() derives the real per-connection
      // host at request time. Enables Claude -> /v1/messages routing in buildUrl.
      messagesUrl: "https://api.githubcopilot.com/v1/messages",
      authType: "oauth",
      authHeader: "bearer",
      ...config,
    });
  }

  // Derive the chat/completions base from gheUrl in providerSpecificData.
  getChatCompletionsBase(credentials) {
    // The GHE token endpoint returns TWO hosts:
    //   endpoints.api   -> copilotApiUrl (chat/completions + the /models catalog)
    //   endpoints.proxy -> copilotProxyUrl (NES / autocomplete only)
    // Chat MUST go to the api host.
    const psd = credentials?.providerSpecificData;
    const apiOrProxy =
      (typeof psd?.copilotApiUrl === "string" ? psd.copilotApiUrl : undefined) ||
      (typeof psd?.copilotProxyUrl === "string" ? psd.copilotProxyUrl : undefined);
    if (apiOrProxy) {
      const base = apiOrProxy
        .replace(/\/chat\/completions\/?$/, "")
        .replace(/\/responses\/?$/, "")
        .replace(/\/+$/, "");
      return base.endsWith("/chat/completions") ? base : `${base}/chat/completions`;
    }
    const gheUrl = psd?.gheUrl;
    if (!gheUrl) {
      throw new Error("GHE Copilot executor requires gheUrl in providerSpecificData");
    }
    const base = gheUrl
      .replace(/\/chat\/completions\/?$/, "")
      .replace(/\/responses\/?$/, "")
      .replace(/\/+$/, "");
    return base.endsWith("/chat/completions") ? base : `${base}/chat/completions`;
  }

  getResponsesBase(credentials) {
    const psd = credentials?.providerSpecificData;
    const apiOrProxy =
      (typeof psd?.copilotApiUrl === "string" ? psd.copilotApiUrl : undefined) ||
      (typeof psd?.copilotProxyUrl === "string" ? psd.copilotProxyUrl : undefined);
    if (apiOrProxy) {
      const base = apiOrProxy
        .replace(/\/chat\/completions\/?$/, "")
        .replace(/\/responses\/?$/, "")
        .replace(/\/+$/, "");
      return `${base}/responses`;
    }
    const gheUrl = psd?.gheUrl;
    if (!gheUrl) {
      throw new Error("GHE Copilot executor requires gheUrl in providerSpecificData");
    }
    const base = gheUrl
      .replace(/\/chat\/completions\/?$/, "")
      .replace(/\/responses\/?$/, "");
    return `${base}/responses`;
  }

  // Derive the Anthropic-native /v1/messages shim base from the GHE host.
  getMessagesBase(credentials) {
    const psd = credentials?.providerSpecificData;
    const apiOrProxy =
      (typeof psd?.copilotApiUrl === "string" ? psd.copilotApiUrl : undefined) ||
      (typeof psd?.copilotProxyUrl === "string" ? psd.copilotProxyUrl : undefined);
    const host = apiOrProxy || psd?.gheUrl;
    if (!host) {
      throw new Error("GHE Copilot executor requires copilotApiUrl or gheUrl in providerSpecificData");
    }
    const base = host
      .replace(/\/v1\/messages\/?$/, "")
      .replace(/\/chat\/completions\/?$/, "")
      .replace(/\/responses\/?$/, "")
      .replace(/\/+$/, "");
    return `${base}/v1/messages`;
  }

  stripPrefix(model) {
    return typeof model === "string" && model.startsWith("ghe-copilot/")
      ? model.slice("ghe-copilot/".length)
      : model;
  }

  buildUrl(model, stream, urlIndex = 0, credentials = null) {
    const bareModel = this.stripPrefix(model);
    const targetFormat = getModelTargetFormat("ghe-copilot", bareModel);
    // Claude models: ALWAYS route to the Anthropic-native /v1/messages shim,
    // matched on the model NAME so a Claude id missing its registry
    // targetFormat tag still gets the native shim.
    if ((targetFormat === "claude" || /claude/i.test(bareModel)) && this.config.messagesUrl) {
      return this.getMessagesBase(credentials);
    }
    if (
      (targetFormat === "openai-responses" || /codex/i.test(bareModel)) &&
      this.supportsResponsesEndpoint(bareModel)
    ) {
      return this.getResponsesBase(credentials);
    }
    return this.getChatCompletionsBase(credentials);
  }

  transformRequest(model, body, stream, credentials) {
    const bareModel = this.stripPrefix(model);
    const transformed = super.transformRequest(bareModel, body, stream, credentials);
    if (transformed && typeof transformed === "object") {
      if (typeof transformed.model === "string") {
        transformed.model = this.stripPrefix(transformed.model);
      }
      // GHE Copilot proxy is streaming-only: force stream:true upstream
      // (chatCore drains the SSE back to JSON for non-stream clients).
      transformed.stream = true;
    }
    return transformed;
  }

  async refreshCopilotToken(githubAccessToken, log, credentials = null) {
    const gheUrl = credentials?.providerSpecificData?.gheUrl;
    if (!gheUrl) return null;
    try {
      const baseUrl = gheUrl
        .replace(/\/chat\/completions\/?$/, "")
        .replace(/\/responses\/?$/, "");
      const tokenUrl = `${baseUrl}/api/v3/copilot_internal/v2/token`;
      const response = await fetch(tokenUrl, {
        headers: {
          Authorization: `Bearer ${githubAccessToken}`,
          Accept: "application/json",
        },
      });
      if (!response.ok) return null;
      const data = await response.json();
      log?.info?.("TOKEN", "GHE Copilot token refreshed");
      // GHE returns a dynamic `endpoints` object; the chat/responses proxy host
      // lives at endpoints.proxy (NOT a static path on the GHE web host).
      const endpoints = data.endpoints
        ? { proxy: data.endpoints.proxy, api: data.endpoints.api }
        : undefined;
      return {
        token: data.token,
        expiresAt: data.expires_at,
        ...(endpoints ? { endpoints } : {}),
      };
    } catch (error) {
      log?.error?.("TOKEN", `GHE Copilot refresh error: ${error.message}`);
      return null;
    }
  }

  async refreshGitHubToken(refreshToken, log, credentials = null) {
    const gheUrl = credentials?.providerSpecificData?.gheUrl;
    if (!gheUrl) return null;
    try {
      const baseUrl = gheUrl
        .replace(/\/chat\/completions\/?$/, "")
        .replace(/\/responses\/?$/, "");
      const tokenUrl = `${baseUrl}/login/oauth/access_token`;
      const params = new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: refreshToken,
        client_id: this.config.clientId,
      });
      if (this.config.clientSecret) {
        params.set("client_secret", this.config.clientSecret);
      }
      const response = await fetch(tokenUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Accept: "application/json",
        },
        body: params,
      });
      if (!response.ok) return null;
      const tokens = await response.json();
      log?.info?.("TOKEN", "GHE GitHub token refreshed");
      return {
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token || refreshToken,
        expiresIn: tokens.expires_in,
      };
    } catch (error) {
      log?.error?.("TOKEN", `GHE GitHub refresh error: ${error.message}`);
      return null;
    }
  }

  buildRefreshedProviderSpecificData(credentials, copilotResult) {
    return {
      ...credentials?.providerSpecificData,
      copilotToken: copilotResult.token,
      copilotTokenExpiresAt: copilotResult.expiresAt,
      copilotApiUrl: copilotResult.endpoints?.api,
      copilotProxyUrl: copilotResult.endpoints?.proxy,
      gheUrl: credentials?.providerSpecificData?.gheUrl,
    };
  }

  async refreshViaGitHubToken(credentials, log) {
    const githubTokens = await this.refreshGitHubToken(
      credentials.refreshToken,
      log,
      credentials
    );
    if (!githubTokens?.accessToken) return null;
    const copilotResult = await this.refreshCopilotToken(githubTokens.accessToken, log, credentials);
    if (!copilotResult) return githubTokens;
    return {
      ...githubTokens,
      copilotToken: copilotResult.token,
      copilotTokenExpiresAt: copilotResult.expiresAt,
      providerSpecificData: this.buildRefreshedProviderSpecificData(credentials, copilotResult),
    };
  }

  async refreshCredentials(credentials, log, proxyOptions = null) {
    const copilotResult = await this.refreshCopilotToken(credentials?.accessToken, log, credentials);
    if (!copilotResult && credentials?.refreshToken) {
      return this.refreshViaGitHubToken(credentials, log);
    }
    if (copilotResult) {
      return {
        accessToken: credentials?.accessToken,
        refreshToken: credentials?.refreshToken,
        copilotToken: copilotResult.token,
        copilotTokenExpiresAt: copilotResult.expiresAt,
        providerSpecificData: this.buildRefreshedProviderSpecificData(credentials, copilotResult),
      };
    }
    return null;
  }
}

export default GheCopilotExecutor;
