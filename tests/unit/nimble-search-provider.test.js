import { afterEach, describe, expect, it, vi } from "vitest";

import REGISTRY from "../../open-sse/providers/registry/index.js";
import { buildSearchRequest } from "../../open-sse/handlers/search/callers.js";
import { handleSearchCore } from "../../open-sse/handlers/search/index.js";
import { normalizeSearchResponse } from "../../open-sse/handlers/search/normalizers.js";
import { handleFetchCore } from "../../open-sse/handlers/fetch/index.js";
import { getProvidersByKind } from "@/shared/constants/providers.js";

const ENTRY = REGISTRY.find((candidate) => candidate.id === "nimble-search");

const PARAMS = {
  query: "nimble web data",
  searchType: "web",
  maxResults: 2,
  token: "nimble-test-key",
  country: "us",
  language: "en",
  timeRange: "month",
  domainFilter: ["nimbleway.com", "-spam.example"],
};

const SEARCH_RESPONSE = {
  total_results: 2,
  request_id: "00000000-0000-0000-0000-000000000000",
  results: [
    {
      title: "Nimble — real-time web data",
      url: "https://www.nimbleway.com/product?ref=1",
      description: "Structured web data for AI applications.",
      content: "",
      metadata: { position: 1, entity_type: "SearchResult", country: "US", locale: "en" },
    },
    {
      title: "Nimble docs",
      url: "https://docs.nimbleway.com/",
      description: "",
      content: "Full page body captured at a deeper search depth.",
      metadata: { position: 2, entity_type: "SearchResult", country: "US", locale: "en" },
    },
  ],
};

const EXTRACT_RESPONSE = {
  status: "success",
  data: {
    markdown: "# Nimble\nReal-time web data.",
    html: "<html><body>Real-time web data.</body></html>",
    links: ["https://docs.nimbleway.com/"],
  },
};

function mockFetch(payload, status = 200) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify(payload), {
      status,
      headers: { "Content-Type": "application/json" },
    }))
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Nimble search provider", () => {
  it("registers nimble-search for webSearch + webFetch with one bearer-auth API key", () => {
    expect(ENTRY).toBeTruthy();
    expect(ENTRY).toMatchObject({
      category: "apikey",
      authType: "apikey",
      serviceKinds: ["webSearch", "webFetch"],
      searchConfig: {
        baseUrl: "https://sdk.nimbleway.com/v1/search",
        method: "POST",
        authHeader: "bearer",
        searchTypes: ["web", "news"],
      },
      fetchConfig: {
        baseUrl: "https://sdk.nimbleway.com/v1/extract",
        method: "POST",
        authHeader: "bearer",
        formats: ["markdown", "html"],
      },
    });
    expect(getProvidersByKind("webSearch").map((p) => p.id)).toContain("nimble-search");
    expect(getProvidersByKind("webFetch").map((p) => p.id)).toContain("nimble-search");
  });

  it("builds the documented Nimble search request with the key in the Authorization header", () => {
    const request = buildSearchRequest({ id: "nimble-search", ...ENTRY.searchConfig }, PARAMS);

    expect(request.url).toBe("https://sdk.nimbleway.com/v1/search");
    expect(request.init.method).toBe("POST");
    expect(request.init.headers).toEqual({
      "Content-Type": "application/json",
      Authorization: "Bearer nimble-test-key",
      "X-Client-Source": "akanesia-router",
    });
    expect(JSON.parse(request.init.body)).toEqual({
      query: "nimble web data",
      max_results: 2,
      search_depth: "lite",
      output_format: "plain_text",
      focus: "general",
      include_domains: ["nimbleway.com"],
      exclude_domains: ["spam.example"],
      country: "US",
      locale: "en",
      time_range: "month",
    });
  });

  it("maps search_type=news onto the Nimble news focus as a scalar", () => {
    const request = buildSearchRequest(
      { id: "nimble-search", ...ENTRY.searchConfig },
      { ...PARAMS, searchType: "news" }
    );
    const body = JSON.parse(request.init.body);
    expect(body.focus).toBe("news");
    expect(Array.isArray(body.focus)).toBe(false);
  });

  it("normalizes Nimble results: description becomes snippet, content becomes full_text", () => {
    const normalized = normalizeSearchResponse("nimble-search", SEARCH_RESPONSE, PARAMS.query, "web");

    expect(normalized.totalResults).toBe(2);
    expect(normalized.results).toHaveLength(2);
    expect(normalized.results[0]).toMatchObject({
      title: "Nimble — real-time web data",
      url: "https://www.nimbleway.com/product?ref=1",
      snippet: "Structured web data for AI applications.",
      citation: { provider: "nimble-search", rank: 1 },
    });
    expect(normalized.results[1].content).toEqual({
      format: "text",
      text: "Full page body captured at a deeper search depth.",
      length: 49,
    });
  });

  it("searches end-to-end through handleSearchCore", async () => {
    mockFetch(SEARCH_RESPONSE);

    const result = await handleSearchCore({
      body: { query: "nimble web data", max_results: 2, search_type: "web" },
      provider: { id: "nimble-search" },
      providerConfig: ENTRY.searchConfig,
      credentials: { apiKey: "nimble-test-key" },
    });

    expect(result.success).toBe(true);
    expect(result.data.provider).toBe("nimble-search");
    expect(result.data.results).toHaveLength(2);
    expect(result.data.results[0].url).toBe("https://www.nimbleway.com/product?ref=1");

    const [requestUrl, init] = vi.mocked(fetch).mock.calls[0];
    expect(String(requestUrl)).toBe("https://sdk.nimbleway.com/v1/search");
    expect(init.headers.Authorization).toBe("Bearer nimble-test-key");
  });
});

describe("Nimble web fetch", () => {
  const FETCH_ARGS = {
    url: "https://www.nimbleway.com/product",
    format: "markdown",
    provider: "nimble-search",
    providerConfig: ENTRY.fetchConfig,
    credentials: { apiKey: "nimble-test-key" },
  };

  it("posts to /v1/extract with the key in the Authorization header and reads markdown", async () => {
    mockFetch(EXTRACT_RESPONSE);

    const result = await handleFetchCore(FETCH_ARGS);

    expect(result.success).toBe(true);
    expect(result.data.provider).toBe("nimble-search");
    expect(result.data.content).toEqual({
      format: "markdown",
      text: "# Nimble\nReal-time web data.",
      length: 28,
    });
    expect(result.data.links).toEqual(["https://docs.nimbleway.com/"]);

    const [requestUrl, init] = vi.mocked(fetch).mock.calls[0];
    expect(String(requestUrl)).toBe("https://sdk.nimbleway.com/v1/extract");
    expect(init.method).toBe("POST");
    expect(init.headers.authorization).toBe("Bearer nimble-test-key");
    expect(JSON.parse(init.body)).toEqual({
      url: "https://www.nimbleway.com/product",
      formats: ["markdown"],
    });
  });

  it("supports html output", async () => {
    mockFetch(EXTRACT_RESPONSE);

    const result = await handleFetchCore({ ...FETCH_ARGS, format: "html" });

    expect(result.success).toBe(true);
    expect(result.data.content.format).toBe("html");
    expect(result.data.content.text).toContain("Real-time web data.");
  });

  it("rejects formats outside markdown/html without calling upstream", async () => {
    mockFetch(EXTRACT_RESPONSE);

    const result = await handleFetchCore({ ...FETCH_ARGS, format: "screenshot" });

    expect(result.success).toBe(false);
    expect(result.status).toBe(400);
    expect(fetch).not.toHaveBeenCalled();
  });
});
