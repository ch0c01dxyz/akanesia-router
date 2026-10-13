import { describe, it, expect } from "vitest";
import { renderMarkdownSafe } from "@/shared/utils/safeMarkdown.js";

// marked stub minimal: cukup untuk menguji sanitasi (bukan marked asli).
const fakeMarked = {
  parse: (md) =>
    md
      // simulasi: link markdown -> <a href>
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>')
      // simulasi: baris lain -> <p>
      .split("\n")
      .map((l) => (l.startsWith("<a") ? l : `<p>${l}</p>`))
      .join("\n"),
};

describe("renderMarkdownSafe", () => {
  it("<img onerror> dari sumber tidak lolos sebagai HTML aktif", () => {
    const html = renderMarkdownSafe(
      '# Judul\n<img src=x onerror="alert(1)">',
      fakeMarked
    );
    expect(html).not.toContain("<img"); // tidak ada tag img aktif
    expect(html).not.toMatch(/<[^>]*onerror=/i); // tidak ada atribut onerror aktif
    expect(html).toContain("&lt;img"); // hanya teks inert
  });

  it("tag script dinetralkan", () => {
    const html = renderMarkdownSafe('<script>alert("xss")</script>', fakeMarked);
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("link javascript: diblokir", () => {
    const html = renderMarkdownSafe("[klik](javascript:alert(1))", fakeMarked);
    expect(html).not.toContain("javascript:");
    expect(html).toContain("#blocked:");
  });

  it("link data: diblokir", () => {
    const html = renderMarkdownSafe("[x](data:text/html,<h1>hi</h1>)", fakeMarked);
    expect(html).not.toContain("data:text/html");
  });

  it("link https normal tetap jalan", () => {
    const html = renderMarkdownSafe("[repo](https://example.com/a)", fakeMarked);
    expect(html).toContain('href="https://example.com/a"');
  });

  it("teks biasa tidak rusak", () => {
    const html = renderMarkdownSafe("a < b dan c > d", fakeMarked);
    expect(html).toContain("a &lt; b dan c &gt; d");
  });
});
