// Render markdown ke HTML tanpa dependensi sanitasi eksternal.
// 1. Netralkan HTML mentah di sumber SEBELUM marked.parse — marked tetap
//    menghasilkan tag strukturalnya sendiri (h1, p, ul, code, ...), tapi
//    `<img onerror=...>` atau tag lain dari sumber menjadi teks biasa.
// 2. Blokir skema URL berbahaya di output (mis. `[x](javascript:...)`),
//    karena marked tidak memfilter href/src.

export function renderMarkdownSafe(md, marked) {
  const text = String(md ?? "");
  const escaped = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  const html = marked.parse(escaped);
  return String(html).replace(
    /(href|src)=("|')\s*(javascript|data|vbscript):/gi,
    "$1=$2#blocked:"
  );
}
