"use client";

import { useState, useRef, useEffect } from "react";
import PropTypes from "prop-types";
import { Button, SearchableSelect } from "@/shared/components";
import { translate } from "@/i18n/runtime";
import {
  buildAvailableModels,
  hasActiveConnection,
  formatMs,
  streamChatCompletion,
} from "./playgroundUtils";

// Maksimal 3 model per perbandingan — batasi biaya & kuota (ide #5b).
const MAX_COMPARE_MODELS = 3;

/**
 * Tab "Compare" — bandingkan 2–3 model provider ini dengan satu prompt,
 * side-by-side, lengkap dengan ringkasan TTFT/latensi/token.
 * Single-prompt saja (tanpa multi-turn) agar scope tetap.
 */
export default function PlaygroundCompareTab({ providerId, providerAlias, models, customModels, disabledModelIds, connections, apiKey, noAuth }) {
  const [modelA, setModelA] = useState("");
  const [modelB, setModelB] = useState("");
  const [modelC, setModelC] = useState(""); // opsional
  const [prompt, setPrompt] = useState("");
  const [running, setRunning] = useState(false);
  // Kolom hasil: [{ modelId, text, ttftMs, latencyMs, usage, error, aborted, done }]
  const [columns, setColumns] = useState([]);
  const controllersRef = useRef(new Map());

  const availableModels = buildAvailableModels(models, customModels, disabledModelIds, providerAlias, providerId);
  const hasConnection = noAuth || hasActiveConnection(connections);

  const modelLabel = (id) => availableModels.find((m) => m.id === id)?.label || id;

  // Default: pilih dua model pertama agar langsung bisa dipakai.
  useEffect(() => {
    if (availableModels.length === 0) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- disengaja: pilih dua model pertama sebagai default saat daftar tersedia; jangan di-refactor
    if (!modelA) setModelA(availableModels[0].id);
    if (!modelB && availableModels.length > 1) setModelB(availableModels[1].id);
  }, [availableModels.length]); // eslint-disable-line react-hooks/exhaustive-deps

  // Abort semua request yang berjalan saat tab di-unmount.
  useEffect(() => () => {
    controllersRef.current.forEach((c) => c.abort());
    controllersRef.current.clear();
  }, []);

  const abortAll = () => {
    controllersRef.current.forEach((c) => c.abort());
    controllersRef.current.clear();
  };

  // Model terpilih yang unik (maks 3). Duplikat dicegah di <select> via
  // disabled, dan divalidasi ulang di sini sebagai pengaman.
  const pickedModels = [modelA, modelB, modelC].filter(Boolean).slice(0, MAX_COMPARE_MODELS);
  const uniqueModels = [...new Set(pickedModels)];
  const canSend = prompt.trim() && !running && uniqueModels.length >= 2 && hasConnection;

  const runOne = async (modelId, text, headers) => {
    const controller = new AbortController();
    controllersRef.current.set(modelId, controller);
    const startedAt = performance.now();
    let ttftMs = null;
    const patch = (p) => setColumns((prev) => prev.map((c) => (c.modelId === modelId ? { ...c, ...p } : c)));
    const finish = () => patch({ done: true, latencyMs: performance.now() - startedAt });
    try {
      await streamChatCompletion({
        url: "/api/v1/chat/completions",
        headers,
        body: {
          model: `${providerAlias}/${modelId}`,
          messages: [{ role: "user", content: text }],
          stream: true,
        },
        signal: controller.signal,
        onDelta: (delta) => {
          if (ttftMs === null) {
            ttftMs = performance.now() - startedAt;
            patch({ ttftMs });
          }
          setColumns((prev) => prev.map((c) => (c.modelId === modelId ? { ...c, text: c.text + delta } : c)));
        },
        // Catatan: angka token dari server sudah termasuk buffer internal
        // server — tampilkan apa adanya, tanpa penyesuaian di klien.
        onUsage: (usage) => patch({ usage }),
        onNonStream: (fallback) => patch({ text: fallback }),
      });
      finish();
    } catch (err) {
      // Abort (tombol Berhenti / kirim ulang) bukan error: tandai berhenti, bukan "Done".
      if (err?.name === "AbortError") {
        patch({ aborted: true });
        finish();
        return;
      }
      patch({ error: err?.message || translate("Request failed") });
      finish();
    } finally {
      controllersRef.current.delete(modelId);
    }
  };

  const runCompare = async () => {
    const text = prompt.trim();
    if (!text || running || uniqueModels.length < 2) return;
    abortAll();
    setRunning(true);
    setColumns(uniqueModels.map((modelId) => ({
      modelId, text: "", ttftMs: null, latencyMs: null, usage: null, error: "", done: false,
    })));

    const headers = { "Content-Type": "application/json", Accept: "text/event-stream" };
    if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

    await Promise.allSettled(uniqueModels.map((modelId) => runOne(modelId, text, headers)));
    setRunning(false);
  };

  // Opsi yang sudah dipilih di select lain disembunyikan agar tidak duplikat
  // (SearchableSelect tidak mendukung option disabled; slot sendiri
  // dikecualikan agar nilai terpilih tetap tampil).
  const isTaken = (id, except) => [modelA, modelB, modelC].some((m, i) => m && m === id && ["A", "B", "C"][i] !== except);

  const renderSelect = (value, setValue, slot, required, ariaLabel) => {
    const options = availableModels
      .filter((m) => !isTaken(m.id, slot))
      .map((m) => ({ value: m.id, label: m.label }));
    if (!required) options.unshift({ value: "", label: translate("Optional") });
    return (
      <SearchableSelect
        options={options}
        value={value}
        onChange={setValue}
        disabled={availableModels.length === 0 || running}
        placeholder={ariaLabel}
        className="w-56"
      />
    );
  };

  const gridCols = columns.length > 2 ? "md:grid-cols-3" : "md:grid-cols-2";
  const anyDone = columns.some((c) => c.done);

  return (
    <div>
      {/* Pemilih model: 2 wajib + 1 opsional */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        {renderSelect(modelA, setModelA, "A", true, translate("Model 1"))}
        <span className="text-xs text-text-muted">vs</span>
        {renderSelect(modelB, setModelB, "B", true, translate("Model 2"))}
        <span className="text-xs text-text-muted">vs</span>
        {renderSelect(modelC, setModelC, "C", false, translate("Model 3 (optional)"))}
      </div>

      {!hasConnection && (
        <p className="mb-3 text-xs text-amber-500">
          {translate("Add a connection above to use the playground.")}
        </p>
      )}

      {/* Kolom hasil side-by-side */}
      {columns.length === 0 ? (
        <p className="mb-3 rounded-lg border border-dashed border-border p-6 text-center text-sm text-text-muted">
          {translate("Select 2–3 models, type a prompt, then Send to compare.")}
        </p>
      ) : (
        <div className={`mb-3 grid grid-cols-1 ${gridCols} gap-3`}>
          {columns.map((col) => (
            <div key={col.modelId} className="flex flex-col rounded-lg border border-border overflow-hidden">
              <div className="flex items-center justify-between gap-2 border-b border-border bg-black/[0.03] dark:bg-white/[0.04] px-3 py-2">
                <span className="truncate text-sm font-medium" title={col.modelId}>{modelLabel(col.modelId)}</span>
                <span className="shrink-0 text-xs text-text-muted">
                  {col.error ? translate("Error") : col.aborted ? translate("Stopped") : col.done ? translate("Done") : "…"}
                </span>
              </div>
              <div className="min-h-40 max-h-80 flex-1 overflow-y-auto p-3 text-sm whitespace-pre-wrap break-words">
                {col.error ? (
                  <p className="text-xs text-red-500 break-words">{col.error}</p>
                ) : (
                  col.text || <span className="text-text-muted">{running && !col.done ? "…" : "—"}</span>
                )}
              </div>
              <div className="border-t border-border px-3 py-2 text-xs text-text-muted">
                <div className="flex justify-between gap-2">
                  <span>TTFT</span><span className="font-medium text-text-main">{formatMs(col.ttftMs)}</span>
                </div>
                <div className="flex justify-between gap-2">
                  <span>{translate("Latency")}</span><span className="font-medium text-text-main">{formatMs(col.latencyMs)}</span>
                </div>
                <div className="flex justify-between gap-2">
                  <span>{translate("Tokens")}</span>
                  <span className="font-medium text-text-main">
                    {col.usage
                      ? `${col.usage.prompt_tokens ?? "—"} / ${col.usage.completion_tokens ?? "—"}`
                      : "—"}
                  </span>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Ringkasan perbandingan */}
      {anyDone && (
        <div className="mb-3 overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-black/[0.03] dark:bg-white/[0.04] text-left">
                <th className="px-3 py-2 text-xs font-medium text-text-muted">{translate("Metric")}</th>
                {columns.map((col) => (
                  <th key={col.modelId} className="px-3 py-2 text-xs font-medium truncate max-w-[160px]" title={col.modelId}>
                    {modelLabel(col.modelId)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              <tr className="border-b border-border/60">
                <td className="px-3 py-1.5 text-xs text-text-muted">TTFT</td>
                {columns.map((col) => (
                  <td key={col.modelId} className="px-3 py-1.5">{formatMs(col.ttftMs)}</td>
                ))}
              </tr>
              <tr className="border-b border-border/60">
                <td className="px-3 py-1.5 text-xs text-text-muted">{translate("Latency")}</td>
                {columns.map((col) => (
                  <td key={col.modelId} className="px-3 py-1.5">{formatMs(col.latencyMs)}</td>
                ))}
              </tr>
              <tr>
                <td className="px-3 py-1.5 text-xs text-text-muted">{translate("Completion tokens")}</td>
                {columns.map((col) => (
                  <td key={col.modelId} className="px-3 py-1.5">
                    {col.usage?.completion_tokens ?? "—"}
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>
      )}

      {/* Input prompt tunggal + Kirim/Berhenti */}
      <div className="flex flex-col gap-2">
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={(e) => {
            if ((e.ctrlKey || e.metaKey) && e.key === "Enter") { e.preventDefault(); runCompare(); }
          }}
          placeholder={translate("Type a prompt to compare...")}
          disabled={running || !hasConnection}
          rows={3}
          className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:border-primary focus:outline-none disabled:opacity-50 resize-y"
        />
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs text-text-muted">
            {uniqueModels.length < 2
              ? translate("Select at least 2 different models.")
              : translate("Ctrl+Enter to send")}
          </p>
          {running ? (
            <Button size="sm" variant="secondary" icon="stop" onClick={abortAll}>
              {translate("Stop")}
            </Button>
          ) : (
            <Button size="sm" icon="send" onClick={runCompare} disabled={!canSend}>
              {translate("Send")}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

PlaygroundCompareTab.propTypes = {
  providerId: PropTypes.string.isRequired,
  providerAlias: PropTypes.string.isRequired,
  models: PropTypes.arrayOf(PropTypes.object),
  customModels: PropTypes.arrayOf(PropTypes.object),
  disabledModelIds: PropTypes.arrayOf(PropTypes.string),
  connections: PropTypes.arrayOf(PropTypes.object),
  apiKey: PropTypes.string,
};
