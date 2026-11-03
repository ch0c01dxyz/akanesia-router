import { describe, it, expect } from "vitest";

import { assertPublicUrl } from "../../src/shared/utils/ssrfGuard.js";

// Regression: the guard blocked 240/4 + broadcast but let multicast through
// (224.0.0.0/4, ff00::/8, and IPv4-mapped forms of both).
describe("ssrfGuard multicast", () => {
  it.each([
    "http://224.0.0.1/x",
    "http://239.255.255.250/x",
    "http://[ff02::1]/x",
    "http://[ff00::1]/x",
    "http://[::ffff:224.0.0.1]/x",
  ])("blocks %s", (url) => {
    expect(() => assertPublicUrl(url)).toThrow(/Blocked URL/);
  });

  it.each([
    "https://93.184.216.34/x",
    "https://example.com/x",
  ])("still allows %s", (url) => {
    expect(() => assertPublicUrl(url)).not.toThrow();
  });
});
