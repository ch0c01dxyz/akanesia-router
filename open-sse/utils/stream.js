import { translateResponse, initState } from "../translator/index.js";
import { FORMATS } from "../translator/formats.js";
import { trackPendingRequest, appendRequestLog } from "@/lib/usageDb.js";
import { extractUsage, mergeUsage, hasValidUsage, estimateUsage, logUsage, addBufferToUsage, filterUsageForFormat, COLORS } from "./usageTracking.js";
import { parseSSELine, hasValuableContent, fixInvalidId, formatSSE } from "./streamHelpers.js";
import { getOpenAIResponsesEventName, isOpenAIResponsesTerminalEvent, formatIncompleteOpenAIResponsesStreamFailure } from "./responsesStreamHelpers.js";
import { dbg, isDebugEnabled } from "./debugLog.js";

import { SSE_DONE, SSE_HEADERS, SSE_HEADERS_NO_BUFFER } from "./sseConstants.js";

export { COLORS, formatSSE };
export { SSE_DONE, SSE_HEADERS, SSE_HEADERS_NO_BUFFER };

// sharedEncoder is stateless — safe to share across streams
const sharedEncoder = new TextEncoder();

/**
 * Stream modes
 */
const STREAM_MODE = {
  TRANSLATE: "translate",    // Full translation between formats
  PASSTHROUGH: "passthrough" // No translation, normalize output, extract usage
};

// Batas tunggu trailer usage sebelum response.completed yang ditunda di-flush paksa.
const PENDING_COMPLETION_FLUSH_MS = 3000;

// ---------------------------------------------------------------------------
// Fast path passthrough (temuan audit #9).
//
// Saat format identik (mode passthrough), jalur normalisasi di bawah tetap
// memanggil JSON.parse + aneka pemeriksaan per baris SSE — padahal untuk baris
// "bersih" output-nya sama persis dengan baris mentah (paling banter dinor-
// malisasi spasi "data:"). Fast path meneruskan baris mentah TANPA parse/
// re-encode bila baris terbukti bersih; bila ada keraguan sedikit pun,
// kembalikan null agar jalur lama yang menangani.
//
// Syarat "bersih" (konservatif — semua harus terpenuhi):
// - Bukan baris data: (komentar ": ...", "event:", baris kosong) → jalur lama
//   meneruskannya sebagai (line + "\n") apa adanya.
// - "data: [DONE]" → diteruskan mentah; streamDoneSent TIDAK diubah (persis
//   seperti jalur lama, termasuk quirk duplikasi [DONE] di flush).
// - Baris "data:" berisi JSON object dengan "choices" (chat chunk OpenAI).
// - id valid: tidak memicu fixInvalidId ("chat"/"completion"/panjang < 8).
// - Ada "object" dan "created" (tidak memicu injeksi field Letta-compat).
// - Tanpa field Azure (prompt_filter_results, content_filter_results).
// - Tanpa "tool_calls" sama sekali (array kosong di-strip jalur lama; yang
//   non-kosong membuat ekstraksi konten via regex menjadi ambigu).
// - Tanpa "usage" (memicu ekstraksi/injeksi usage di jalur lama).
// - Tanpa "type"/"response" (memicu deteksi terminal Responses API).
// - finish_reason: tidak ada, atau null (non-null memicu injeksi usage).
// - Terbukti punya konten berharga (tidak akan di-drop oleh hasValuableContent):
//   content/reasoning_content string non-kosong, atau delta.role non-kosong.
//
// Efek samping yang direplikasi agar identik dengan jalur lama:
// - totalContentLength / accumulatedContent / accumulatedThinking diakumulasi
//   dari content/reasoning_content (di-unescape via JSON.parse atas literal
//   string-nya saja — jauh lebih murah daripada parse seluruh baris).
// - reqLogger.appendConvertedChunk tetap dipanggil dengan output yang sama.
//
// @returns {{output:string, content:string, thinking:string}|null}
// ---------------------------------------------------------------------------
const RE_ID_BERSIH = /"id"\s*:\s*"([^"]*)"/;
const RE_FINISH_REASON = /"finish_reason"\s*:\s*(null|"[^"]*")/;
const RE_TOOL_CALLS_KOSONG = /"tool_calls"\s*:\s*\[\s*\]/;
const RE_CONTENT = /"content"\s*:\s*"((?:[^"\\]|\\.)*)"/;
const RE_REASONING = /"reasoning_content"\s*:\s*"((?:[^"\\]|\\.)*)"/;
const RE_ROLE = /"role"\s*:\s*"[^"]+"/;

// Normalisasi spasi "data:" — replika persis cabang output jalur lama.
function normalisasiBarisCepat(line) {
  if (line.startsWith("data:") && !line.startsWith("data: ")) {
    return "data: " + line.slice(5) + "\n";
  }
  return line + "\n";
}

function cobaFastPathPassthrough(line, trimmed) {
  // Bukan baris data: → jalur lama meneruskan mentah (line + "\n").
  if (!trimmed.startsWith("data:")) {
    return { output: line + "\n", content: "", thinking: "" };
  }
  const payload = trimmed.slice(5).trim();
  // Sentinel [DONE] → diteruskan mentah, streamDoneSent tidak diubah.
  if (payload === "[DONE]") {
    return { output: normalisasiBarisCepat(line), content: "", thinking: "" };
  }
  // Bukan JSON object → jalur lama me-skip baris ini; jangan teruskan.
  if (!payload.startsWith("{")) return null;
  // Fast path hanya untuk chat chunk OpenAI.
  if (!payload.includes("\"choices\"")) return null;
  // Pemicu mutasi pada jalur lama → serahkan ke jalur lama:
  if (payload.includes("prompt_filter_results")) return null;  // strip field Azure
  if (payload.includes("content_filter_results")) return null;  // strip field Azure
  if (RE_TOOL_CALLS_KOSONG.test(payload)) return null;          // strip array kosong
  if (payload.includes("\"tool_calls\"")) return null;         // ekstraksi konten ambigu
  if (payload.includes("\"usage\"")) return null;              // ekstraksi/injeksi usage
  if (payload.includes("\"type\"")) return null;               // deteksi terminal Responses
  if (payload.includes("\"response\"")) return null;           // deteksi terminal Responses
  if (!payload.includes("\"object\"") || !payload.includes("\"created\"")) return null; // injeksi field
  // finish_reason non-null → injeksi estimated usage → jalur lama.
  if (payload.includes("\"finish_reason\"")) {
    const m = payload.match(RE_FINISH_REASON);
    if (!m || m[1] !== "null") return null;
  }
  // fixInvalidId: id generik/terlalu pendek → jalur lama.
  const idM = payload.match(RE_ID_BERSIH);
  if (idM) {
    const id = idM[1];
    if (id.length < 8 || id === "chat" || id === "completion") return null;
  }
  // Buktikan konten berharga (hasValuableContent) agar tidak di-drop jalur lama.
  // Catatan: kunci JSON di konten string selalu ter-escape (\"...\"), sehingga
  // pencarian literal "\"content\"" tidak tertipu isi teks.
  let content = "";
  let thinking = "";
  const mc = payload.match(RE_CONTENT);
  if (mc) {
    try {
      content = JSON.parse(`"${mc[1]}"`);
    } catch {
      return null; // JSON tidak valid → jalur lama akan skip baris ini
    }
  }
  const mr = payload.match(RE_REASONING);
  if (mr) {
    try {
      thinking = JSON.parse(`"${mr[1]}"`);
    } catch {
      return null;
    }
  }
  if (content === "" && thinking === "" && !RE_ROLE.test(payload)) return null;
  return { output: normalisasiBarisCepat(line), content, thinking };
}

/**
 * Create unified SSE transform stream
 * @param {object} options
 * @param {string} options.mode - Stream mode: translate, passthrough
 * @param {string} options.targetFormat - Provider format (for translate mode)
 * @param {string} options.sourceFormat - Client format (for translate mode)
 * @param {string} options.provider - Provider name
 * @param {object} options.reqLogger - Request logger instance
 * @param {string} options.model - Model name
 * @param {string} options.connectionId - Connection ID for usage tracking
 * @param {object} options.body - Request body (for input token estimation)
 * @param {function} options.onStreamComplete - Callback when stream completes
 *   (content, usage, ttftAt, firstClientByteAt). ttftAt = timestamp byte pertama
 *   dari upstream; firstClientByteAt = timestamp payload pertama ke klien
 *   (null bila tidak ada byte terkirim).
 * @param {string} options.apiKey - API key for usage tracking
 */
export function createSSEStream(options = {}) {
  const {
    mode = STREAM_MODE.TRANSLATE,
    targetFormat,
    sourceFormat,
    provider = null,
    reqLogger = null,
    toolNameMap = null,
    customToolNames = null,
    model = null,
    connectionId = null,
    body = null,
    onStreamComplete = null,
    apiKey = null,
    credentials = null
  } = options;

  let buffer = "";
  let usage = null;

  // Per-stream decoder with stream:true to correctly handle multi-byte chars split across chunks
  const decoder = new TextDecoder("utf-8", { fatal: false });

  const state = mode === STREAM_MODE.TRANSLATE
    ? { ...initState(sourceFormat), provider, toolNameMap, customToolNames: new Set(customToolNames || []), model, sessionId: credentials?._clientSessionId || null,
        // Which upstream format this stream came from. A response translator can be
        // reached either directly (target === its registered source) or as the second
        // hop of a pivot, and on the terminal null chunk the pivot drops it — so a
        // translator that defers closing events until flush needs to know which case
        // it is in. Absent/undefined means "unknown", i.e. do not defer.
        targetFormat }
    : null;

  let totalContentLength = 0;
  let accumulatedContent = "";
  let accumulatedThinking = "";
  let ttftAt = null;
  // Waktu payload pertama yang benar-benar dikirim ke klien (enqueue pertama
  // ke controller). Berbeda dengan ttftAt yang mengukur byte pertama dari
  // upstream — di antaranya ada buffering/parse/translate. Keduanya dilaporkan
  // via onStreamComplete sebagai dua metrik terpisah (temuan audit #8).
  let firstClientByteAt = null;
  // Pembungkus enqueue: catat timestamp kirim-pertama-ke-klien tepat di titik
  // byte pertama keluar, bukan saat chunk tiba dari upstream.
  const enqueueKeKlien = (ctrl, bytes) => {
    if (!firstClientByteAt) firstClientByteAt = Date.now();
    ctrl.enqueue(bytes);
  };
  let sseLineCount = 0;
  let sseEmittedCount = 0;
  const eventTypeCounts = {};

  // Track Responses API event framing for same-format passthrough (codex)
  let currentOpenAIResponsesEvent = null;
  let openAIResponsesTerminalSeen = false;
  let openAIResponsesDoneSent = false;
  let streamDoneSent = false;  // track duplicate [DONE] across transform + flush
  let finalized = false;
  // Timer watchdog untuk response.completed yang ditunda (null bila tidak aktif).
  let completionFlushTimer = null;

  // Flush response.completed yang ditunda menunggu trailer usage
  // (lihat state.completionPending di translator). Dipakai cabang [DONE]
  // dan watchdog di bawah.
  const flushPendingCompletion = (controller) => {
    const completed = translateResponse(targetFormat, sourceFormat, null, state);
    for (const item of completed || []) {
      if (item === null || item === undefined) continue;
      const output = formatSSE(item, sourceFormat);
      reqLogger?.appendConvertedChunk?.(output);
      enqueueKeKlien(controller, sharedEncoder.encode(output));
      sseEmittedCount++;
    }
    finalizeStream();
  };

  // Usage/logging tail, callable from transform() as well as flush(): a client that
  // closes right after the terminal event cancels the reader, and flush() never runs.
  const finalizeStream = () => {
    if (completionFlushTimer) { clearTimeout(completionFlushTimer); completionFlushTimer = null; }
    if (finalized) return;
    finalized = true;

    const isPassthrough = mode === STREAM_MODE.PASSTHROUGH;
    let finalUsage = isPassthrough ? usage : state?.usage;

    if (!hasValidUsage(finalUsage) && totalContentLength > 0) {
      finalUsage = estimateUsage(body, totalContentLength, isPassthrough ? FORMATS.OPENAI : sourceFormat);
      if (isPassthrough) usage = finalUsage; else state.usage = finalUsage;
    }

    if (hasValidUsage(finalUsage)) {
      logUsage(isPassthrough ? provider : (state?.provider || targetFormat), finalUsage, model, connectionId, apiKey);
    } else {
      appendRequestLog({ model, provider, connectionId, tokens: null, status: "200 OK" }).catch(() => { });
    }

    if (onStreamComplete) {
      // Argumen ke-4 (firstClientByteAt) bersifat opsional & backward-compatible:
      // callback lama dengan 3 parameter tetap jalan; yang baru bisa memakai
      // metrik "payload pertama ke klien" di samping ttftAt (byte pertama upstream).
      onStreamComplete({
        content: accumulatedContent,
        thinking: accumulatedThinking
      }, finalUsage, ttftAt, firstClientByteAt);
    }
  };

  return new TransformStream({
    transform(chunk, controller) {
      if (!ttftAt) ttftAt = Date.now();
      const text = decoder.decode(chunk, { stream: true });
      buffer += text;
      reqLogger?.appendProviderChunk?.(text);

      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (isDebugEnabled && trimmed) {
          sseLineCount++;
          if (trimmed.startsWith("event:")) {
            const evt = trimmed.slice(6).trim();
            eventTypeCounts[evt] = (eventTypeCounts[evt] || 0) + 1;
          }
        }

        // Capture Responses API event name to preserve framing in same-format passthrough
        if (mode === STREAM_MODE.TRANSLATE && targetFormat === FORMATS.OPENAI_RESPONSES && trimmed.startsWith("event:")) {
          currentOpenAIResponsesEvent = trimmed.slice(6).trim();
        }

        // Passthrough mode: normalize and forward
        if (mode === STREAM_MODE.PASSTHROUGH) {
          // Fast path (audit #9): baris "bersih" diteruskan mentah tanpa
          // JSON.parse/re-encode — output byte-identik dengan jalur normalisasi
          // di bawah. Kembalikan null bila ragu → jalur lama yang menangani.
          // (Sengaja hanya di mode passthrough: jalur translate dengan format
          //  identik seperti keepsOpenAIResponsesFormat butuh framing event +
          //  sintesis terminal Responses API sehingga tidak aman di-raw-kan.)
          const cepat = cobaFastPathPassthrough(line, trimmed);
          if (cepat) {
            // Replikasi efek samping jalur lama untuk logging/estimasi usage.
            totalContentLength += cepat.content.length + cepat.thinking.length;
            accumulatedContent += cepat.content;
            accumulatedThinking += cepat.thinking;
            reqLogger?.appendConvertedChunk?.(cepat.output);
            enqueueKeKlien(controller, sharedEncoder.encode(cepat.output));
            continue;
          }

          let output;
          let injectedUsage = false;
          let responsesTerminal = false;

          if (trimmed.startsWith("data:") && trimmed.slice(5).trim() !== "[DONE]") {
            try {
              const parsed = JSON.parse(trimmed.slice(5).trim());

              const idFixed = fixInvalidId(parsed);

              // Ensure OpenAI-required fields are present on streaming chunks (Letta compat)
              let fieldsInjected = false;
              if (parsed.choices !== undefined) {
                if (!parsed.object) { parsed.object = "chat.completion.chunk"; fieldsInjected = true; }
                if (!parsed.created) { parsed.created = Math.floor(Date.now() / 1000); fieldsInjected = true; }
              }

              // Strip Azure-specific non-standard fields from streaming chunks
              if (parsed.prompt_filter_results !== undefined) {
                delete parsed.prompt_filter_results;
                fieldsInjected = true;
              }
              if (parsed?.choices) {
                for (const choice of parsed.choices) {
                  if (choice.content_filter_results !== undefined) {
                    delete choice.content_filter_results;
                    fieldsInjected = true;
                  }
                }
              }

              // Strip empty tool_calls arrays that break AI SDK reasoning tracking.
              // Some providers (e.g. CodeBuddy CN) include `"tool_calls": []` in
              // every streaming delta. @ai-sdk/openai-compatible checks
              // `delta.tool_calls != null` — an empty array passes this check,
              // causing premature `reasoning-end` on every chunk.
              if (parsed?.choices) {
                for (const choice of parsed.choices) {
                  if (choice.delta?.tool_calls && Array.isArray(choice.delta.tool_calls) && choice.delta.tool_calls.length === 0) {
                    delete choice.delta.tool_calls;
                    fieldsInjected = true;
                  }
                }
              }

              if (!hasValuableContent(parsed, FORMATS.OPENAI)) {
                continue;
              }

              const delta = parsed.choices?.[0]?.delta;
              const content = delta?.content;
              const reasoning = delta?.reasoning_content;
              if (content && typeof content === "string") {
                totalContentLength += content.length;
                accumulatedContent += content;
              }
              if (reasoning && typeof reasoning === "string") {
                totalContentLength += reasoning.length;
                accumulatedThinking += reasoning;
              }

              const extracted = extractUsage(parsed);
              if (extracted) {
                usage = mergeUsage(usage, extracted);
              }

              responsesTerminal = isOpenAIResponsesTerminalEvent(currentOpenAIResponsesEvent, parsed);

              const isFinishChunk = parsed.choices?.[0]?.finish_reason;
              if (isFinishChunk && !hasValidUsage(parsed.usage)) {
                const estimated = estimateUsage(body, totalContentLength, FORMATS.OPENAI);
                parsed.usage = filterUsageForFormat(estimated, FORMATS.OPENAI);
                output = `data: ${JSON.stringify(parsed)}\n`;
                usage = estimated;
                injectedUsage = true;
              } else if (isFinishChunk && usage) {
                const buffered = addBufferToUsage(usage);
                parsed.usage = filterUsageForFormat(buffered, FORMATS.OPENAI);
                output = `data: ${JSON.stringify(parsed)}\n`;
                injectedUsage = true;
              } else if (idFixed || fieldsInjected) {
                output = `data: ${JSON.stringify(parsed)}\n`;
                injectedUsage = true;
              }
            } catch {
              // Skip non-JSON data lines silently — don't forward garbage to clients.
              // Upstream providers sometimes return plain-text errors (HTML, rate-limit
              // messages) in the SSE stream that would break downstream JSON decoders.
              continue;
            }
          }

          if (!injectedUsage) {
            if (line.startsWith("data:") && !line.startsWith("data: ")) {
              output = "data: " + line.slice(5) + "\n";
            } else {
              output = line + "\n";
            }
          }

          reqLogger?.appendConvertedChunk?.(output);
          enqueueKeKlien(controller, sharedEncoder.encode(output));
          // Responses clients (codex CLI) close on response.completed instead of [DONE]
          if (responsesTerminal) finalizeStream();
          continue;
        }

        // Translate mode
        if (!trimmed) continue;

        const parsed = parseSSELine(trimmed, targetFormat);
        if (!parsed) continue;

        // Responses API same-format passthrough: preserve event framing + track terminal state
        const isOpenAIResponsesStream = targetFormat === FORMATS.OPENAI_RESPONSES;
        const keepsOpenAIResponsesFormat = isOpenAIResponsesStream && sourceFormat === FORMATS.OPENAI_RESPONSES;
        const openAIResponsesEventName = isOpenAIResponsesStream
          ? getOpenAIResponsesEventName(currentOpenAIResponsesEvent, parsed)
          : null;

        if (isOpenAIResponsesStream && isOpenAIResponsesTerminalEvent(openAIResponsesEventName, parsed)) {
          openAIResponsesTerminalSeen = true;
        }

        // For Ollama: done=true is the final chunk with finish_reason/usage, must translate
        // For other formats: done=true is the [DONE] sentinel, skip
        if (parsed && parsed.done && targetFormat !== FORMATS.OLLAMA) {
          // Translasi Chat-ke-Responses langsung bisa menunda response.completed
          // sambil menunggu trailer usage. [DONE] mengakhiri kesempatan itu walau
          // upstream masih menahan koneksi HTTP, jadi selesaikan sekarang.
          if (targetFormat === FORMATS.OPENAI && sourceFormat === FORMATS.OPENAI_RESPONSES &&
              state.completionPending && !state.completedSent) {
            flushPendingCompletion(controller);
          }

          // Synthesize response.failed if the Responses stream never sent a terminal event
          if (keepsOpenAIResponsesFormat && !openAIResponsesTerminalSeen) {
            const failedOutput = formatIncompleteOpenAIResponsesStreamFailure();
            reqLogger?.appendConvertedChunk?.(failedOutput);
            enqueueKeKlien(controller, sharedEncoder.encode(failedOutput));
            openAIResponsesTerminalSeen = true;
            sseEmittedCount++;
          }

          if (keepsOpenAIResponsesFormat && !streamDoneSent) {
            const doneOutput = "data: [DONE]\n\n";
            reqLogger?.appendConvertedChunk?.(doneOutput);
            enqueueKeKlien(controller, sharedEncoder.encode(doneOutput));
          }
          streamDoneSent = true;
          if (keepsOpenAIResponsesFormat) openAIResponsesDoneSent = true;
          continue;
        }

        // Claude format - content
        if (parsed.delta?.text) {
          totalContentLength += parsed.delta.text.length;
          accumulatedContent += parsed.delta.text;
        }
        // Claude format - thinking
        if (parsed.delta?.thinking) {
          totalContentLength += parsed.delta.thinking.length;
          accumulatedThinking += parsed.delta.thinking;
        }
        
        // OpenAI format - content
        if (parsed.choices?.[0]?.delta?.content) {
          totalContentLength += parsed.choices[0].delta.content.length;
          accumulatedContent += parsed.choices[0].delta.content;
        }
        // OpenAI format - reasoning
        if (parsed.choices?.[0]?.delta?.reasoning_content) {
          totalContentLength += parsed.choices[0].delta.reasoning_content.length;
          accumulatedThinking += parsed.choices[0].delta.reasoning_content;
        }
        
        // Gemini format
        if (parsed.candidates?.[0]?.content?.parts) {
          for (const part of parsed.candidates[0].content.parts) {
            if (part.text && typeof part.text === "string") {
              totalContentLength += part.text.length;
              // Check if this is thinking content
              if (part.thought === true) {
                accumulatedThinking += part.text;
              } else {
                accumulatedContent += part.text;
              }
            }
          }
        }

        // Extract usage
        const extracted = extractUsage(parsed);
        if (extracted) state.usage = mergeUsage(state.usage, extracted); // Keep original usage for logging

        // Responses same-format passthrough: re-emit with original event framing
        if (keepsOpenAIResponsesFormat && openAIResponsesEventName) {
          const output = formatSSE({ event: openAIResponsesEventName, data: parsed }, sourceFormat);
          reqLogger?.appendConvertedChunk?.(output);
          enqueueKeKlien(controller, sharedEncoder.encode(output));
          currentOpenAIResponsesEvent = null;
          sseEmittedCount++;
          // Responses clients (codex) close on response.completed instead of [DONE]
          if (openAIResponsesTerminalSeen) finalizeStream();
          continue;
        }

        currentOpenAIResponsesEvent = null;

        // Translate: targetFormat -> openai -> sourceFormat
        const translated = translateResponse(targetFormat, sourceFormat, parsed, state);

        // Log OpenAI intermediate chunks (if available)
        if (translated?._openaiIntermediate) {
          for (const item of translated._openaiIntermediate) {
            const openaiOutput = formatSSE(item, FORMATS.OPENAI);
            reqLogger?.appendOpenAIChunk?.(openaiOutput);
          }
        }

        if (translated?.length > 0) {
          for (const item of translated) {
            if (item === null || item === undefined) continue;
            // Filter empty chunks
            if (!hasValuableContent(item, sourceFormat)) {
              continue; // Skip this empty chunk
            }

            // Inject estimated usage if finish chunk has no valid usage
            const isFinishChunk = item.type === "message_delta" || item.choices?.[0]?.finish_reason;
            if (state.finishReason && isFinishChunk && !hasValidUsage(item.usage) && totalContentLength > 0) {
              const estimated = estimateUsage(body, totalContentLength, sourceFormat);
              item.usage = filterUsageForFormat(estimated, sourceFormat); // Filter + already has buffer
              state.usage = estimated;
            } else if (state.finishReason && isFinishChunk && state.usage) {
              // Add buffer and filter usage for client (but keep original in state.usage for logging)
              const buffered = addBufferToUsage(state.usage);
              item.usage = filterUsageForFormat(buffered, sourceFormat);
            }

            const output = formatSSE(item, sourceFormat);
            reqLogger?.appendConvertedChunk?.(output);
            enqueueKeKlien(controller, sharedEncoder.encode(output));
            sseEmittedCount++;
          }
        }

        // Penundaan completion bisa lebih lama dari umur upstream: upstream chat
        // yang rusak bisa stall setelah finish_reason tanpa trailer usage dan tanpa
        // [DONE], menahan koneksi tetap terbuka. Batasi tunggunya agar klien
        // tetap mendapat terminal event.
        if (targetFormat === FORMATS.OPENAI && sourceFormat === FORMATS.OPENAI_RESPONSES &&
            state?.completionPending && !state?.completedSent && !completionFlushTimer) {
          completionFlushTimer = setTimeout(() => {
            completionFlushTimer = null;
            if (state?.completedSent) return;
            // Jangan flush ke stream yang sudah error/closed (mis. transform()
            // throw saat timer armed): finalizeStream()/onStreamComplete tidak
            // boleh jalan di error path. desiredSize null = stream tak readable.
            if (controller.desiredSize === null) return;
            try { flushPendingCompletion(controller); } catch { /* controller sudah ditutup */ }
          }, PENDING_COMPLETION_FLUSH_MS);
        }
      }
    },

    flush(controller) {
      const evtSummary = Object.entries(eventTypeCounts).map(([k, v]) => `${k}=${v}`).join(",") || "none";
      dbg("SSE", `flush | provider=${provider} | model=${model} | recvLines=${sseLineCount} | emitted=${sseEmittedCount} | events=[${evtSummary}]`);
      trackPendingRequest(model, provider, connectionId, false);
      try {
        const remaining = decoder.decode();
        if (remaining) buffer += remaining;

        if (mode === STREAM_MODE.PASSTHROUGH) {
          if (buffer) {
            let output = buffer;
            if (buffer.startsWith("data:") && !buffer.startsWith("data: ")) {
              output = "data: " + buffer.slice(5);
            }
            reqLogger?.appendConvertedChunk?.(output);
            enqueueKeKlien(controller, sharedEncoder.encode(output));
          }

          // IMPORTANT: In passthrough mode we still must terminate the SSE stream.
          // Some clients (e.g. OpenClaw) expect the OpenAI-style sentinel:
          //   data: [DONE]\n\n
          // Without it they can hang until timeout and trigger failover.
          // Gemini-family clients (Antigravity, Vertex, Gemini) reject this sentinel with 400 syntax errors.
          const isGeminiFamily = provider === "antigravity" || provider === "gemini" || provider === "vertex";
          if (!streamDoneSent && !isGeminiFamily) {
            const doneOutput = "data: [DONE]\n\n";
            reqLogger?.appendConvertedChunk?.(doneOutput);
            enqueueKeKlien(controller, sharedEncoder.encode(doneOutput));
          }

          finalizeStream();
          return;
        }

        if (buffer.trim()) {
          // Same parse as the transform loop: without targetFormat this only
          // accepts "data: " lines, so an NDJSON provider (Ollama) lost whatever
          // arrived without its closing newline.
          const parsed = parseSSELine(buffer.trim(), targetFormat);
          // parseSSELine turns the SSE sentinel "data: [DONE]" into { done: true },
          // which must not be translated. An Ollama chunk also carries done:true,
          // but it is the real final chunk — it holds finish_reason and the token
          // counts — so it has to go through.
          const isDoneSentinel = parsed?.done && targetFormat !== FORMATS.OLLAMA;
          if (parsed && !isDoneSentinel) {
            // Same accumulation the transform loop does, so finalizeStream() can
            // log a tail chunk's tokens instead of falling back to null.
            const extracted = extractUsage(parsed);
            if (extracted) state.usage = mergeUsage(state.usage, extracted);

            const translated = translateResponse(targetFormat, sourceFormat, parsed, state);

            if (translated?._openaiIntermediate) {
              for (const item of translated._openaiIntermediate) {
                const openaiOutput = formatSSE(item, FORMATS.OPENAI);
                reqLogger?.appendOpenAIChunk?.(openaiOutput);
              }
            }

            if (translated?.length > 0) {
              for (const item of translated) {
                if (item === null || item === undefined) continue;
                const output = formatSSE(item, sourceFormat);
                reqLogger?.appendConvertedChunk?.(output);
                enqueueKeKlien(controller, sharedEncoder.encode(output));
              }
            }
          }
        }

        const flushed = translateResponse(targetFormat, sourceFormat, null, state);

        if (flushed?._openaiIntermediate) {
          for (const item of flushed._openaiIntermediate) {
            const openaiOutput = formatSSE(item, FORMATS.OPENAI);
            reqLogger?.appendOpenAIChunk?.(openaiOutput);
          }
        }

        if (flushed?.length > 0) {
          for (const item of flushed) {
            if (item === null || item === undefined) continue;
            const output = formatSSE(item, sourceFormat);
            reqLogger?.appendConvertedChunk?.(output);
            enqueueKeKlien(controller, sharedEncoder.encode(output));
          }
        }

        // Synthesize response.failed if a Responses passthrough stream never reached a terminal event
        const keepsOpenAIResponsesFormat = targetFormat === FORMATS.OPENAI_RESPONSES && sourceFormat === FORMATS.OPENAI_RESPONSES;
        if (keepsOpenAIResponsesFormat && !openAIResponsesTerminalSeen) {
          const failedOutput = formatIncompleteOpenAIResponsesStreamFailure();
          reqLogger?.appendConvertedChunk?.(failedOutput);
          enqueueKeKlien(controller, sharedEncoder.encode(failedOutput));
          openAIResponsesTerminalSeen = true;
        }

        if (keepsOpenAIResponsesFormat && !openAIResponsesDoneSent && !streamDoneSent) {
          const doneOutput = "data: [DONE]\n\n";
          reqLogger?.appendConvertedChunk?.(doneOutput);
          enqueueKeKlien(controller, sharedEncoder.encode(doneOutput));
          openAIResponsesDoneSent = true;
          streamDoneSent = true;
        }

        finalizeStream();
      } catch (error) {
        console.log("Error in flush:", error);
        finalizeStream();
      }
    }
  });
}

export function createSSETransformStreamWithLogger(targetFormat, sourceFormat, provider = null, reqLogger = null, toolNameMap = null, model = null, connectionId = null, body = null, onStreamComplete = null, apiKey = null, customToolNames = null, credentials = null) {
  return createSSEStream({
    mode: STREAM_MODE.TRANSLATE,
    targetFormat,
    sourceFormat,
    provider,
    reqLogger,
    toolNameMap,
    customToolNames,
    model,
    connectionId,
    body,
    onStreamComplete,
    apiKey,
    credentials
  });
}

export function createPassthroughStreamWithLogger(provider = null, reqLogger = null, model = null, connectionId = null, body = null, onStreamComplete = null, apiKey = null) {
  return createSSEStream({
    mode: STREAM_MODE.PASSTHROUGH,
    provider,
    reqLogger,
    model,
    connectionId,
    body,
    onStreamComplete,
    apiKey
  });
}
