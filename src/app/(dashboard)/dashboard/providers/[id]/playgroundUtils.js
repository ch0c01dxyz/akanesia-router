/**
 * Util bersama untuk tab Playground provider (Test & Compare).
 *
 * Berisi helper murni + satu helper streaming SSE sehingga kedua tab
 * memakai pipeline executor yang sama (konsisten dengan koneksi tersimpan).
 */

/**
 * Bangun daftar model yang tersedia untuk playground: model provider +
 * custom model, dikurangi yang di-disable. Hanya model dari provider ini.
 *
 * @param {Array} models - model bawaan provider ({ id, name })
 * @param {Array} customModels - custom model user
 * @param {Array} disabledModelIds - id model yang di-disable
 * @param {string} providerAlias - alias storage provider
 * @param {string} providerId - id provider
 * @returns {Array<{id: string, label: string}>}
 */
export function buildAvailableModels(models, customModels, disabledModelIds, providerAlias, providerId) {
  const disabled = new Set(disabledModelIds || []);
  const list = (models || [])
    .filter((m) => m && m.id && !disabled.has(m.id))
    .map((m) => ({ id: m.id, label: m.name || m.id }));
  for (const entry of customModels || []) {
    if (entry.providerAlias !== providerAlias && entry.providerAlias !== providerId) continue;
    if ((entry.kind || entry.type || "llm") !== "llm") continue;
    if (!entry.id || disabled.has(entry.id)) continue;
    if (list.some((m) => m.id === entry.id)) continue;
    list.push({ id: entry.id, label: entry.id });
  }
  return list;
}

/**
 * Cek apakah ada koneksi aktif yang bisa dipakai playground.
 * @param {Array} connections
 * @returns {boolean}
 */
export function hasActiveConnection(connections) {
  return (connections || []).some((c) => c.isActive !== false);
}

/**
 * Format milidetik untuk statistik (TTFT/latensi).
 * @param {number|null|undefined} ms
 * @returns {string} contoh "123 ms", atau "—" bila belum ada data
 */
export function formatMs(ms) {
  if (ms == null || Number.isNaN(ms)) return "—";
  return `${Math.round(ms)} ms`;
}

/**
 * Parse satu payload SSE (tanpa awalan "data:").
 *
 * @param {string} payload - isi setelah "data:"
 * @returns {{type: "done"} | {type: "ignore"} | {type: "delta", content: string, usage: object|null}}
 */
export function parseSsePayload(payload) {
  if (payload === "[DONE]") return { type: "done" };
  let json;
  try {
    json = JSON.parse(payload);
  } catch {
    return { type: "ignore" }; // abaikan chunk SSE yang malformed
  }
  const choice = json?.choices?.[0] || {};
  return {
    type: "delta",
    content: choice?.delta?.content || choice?.message?.content || "",
    // Server menginject usage di finish chunk (top-level "usage");
    // fallback ke choices[0].usage untuk executor yang menaruhnya di sana.
    usage: json?.usage || choice?.usage || null,
  };
}

/**
 * Streaming SSE chat completion (OpenAI-compatible).
 * Dipakai ulang oleh tab Test & Compare agar pipeline-nya identik.
 *
 * @param {object} opts
 * @param {string} opts.url - endpoint (mis. "/api/v1/chat/completions")
 * @param {object} opts.headers - header request
 * @param {object} opts.body - body JSON (model, messages, stream: true)
 * @param {AbortSignal} [opts.signal] - untuk abort (AbortError diteruskan ke pemanggil)
 * @param {(content: string) => void} [opts.onDelta] - dipanggil tiap ada potongan konten (non-kosong)
 * @param {(usage: object) => void} [opts.onUsage] - dipanggil saat chunk membawa usage
 * @param {(text: string) => void} [opts.onNonStream] - fallback bila respons bukan SSE
 * @returns {Promise<void>} resolve saat stream selesai
 * @throws {Error} bila HTTP tidak ok (pesan error diambil dari body server bila ada)
 */
export async function streamChatCompletion({ url, headers, body, signal, onDelta, onUsage, onNonStream }) {
  const response = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    signal,
  });

  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data?.error?.message || data?.error || `Request failed (${response.status})`);
  }

  const reader = response.body?.getReader();
  if (!reader) {
    const data = await response.json().catch(() => ({}));
    const fallback = data?.choices?.[0]?.message?.content || "";
    onNonStream?.(fallback);
    return;
  }

  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() || "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) continue;
      const part = parseSsePayload(trimmed.slice(5).trim());
      if (part.type !== "delta") continue;
      if (part.content) onDelta?.(part.content);
      if (part.usage) onUsage?.(part.usage);
    }
  }
}
