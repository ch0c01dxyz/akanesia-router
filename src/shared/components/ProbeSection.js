"use client";

import { useState, useRef, useEffect } from "react";
import PropTypes from "prop-types";
import { cn } from "@/shared/utils/cn";
import { translate } from "@/i18n/runtime";
import { Button } from "@/shared/components";
import { PROBE } from "open-sse/config/probe.js";
import SearchableSelect from "./SearchableSelect";
import MetricCard from "./MetricCard";
import ProbeGroupRow from "./ProbeGroupRow";
import WarningList from "./WarningList";

/**
 * Tab "Probe" (ide #5c) — cek keaslian LLM provider (asli vs masking).
 *
 * Dua sub-tab config-driven: "Offline" (baterai fingerprinting lokal, ±13
 * call) dan "Online" (via BazaarLink Probe API, 84 tes standar + 2 opsional;
 * jumlah request dan biaya upstream bervariasi — consent eksplisit wajib).
 *
 * Catatan: helper buildModelOptions di bawah menduplikasi logika
 * buildAvailableModels dari playgroundUtils.js secara sengaja — import
 * lintas direktori app/ dari shared/components melanggar layering
 * (shared = generik, app = halaman). Bila logika daftar model berubah,
 * sinkronkan kedua tempat ini.
 */
function buildModelOptions(models, customModels, disabledModelIds, providerAlias, providerId) {
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
  return list.map((m) => ({ value: m.id, label: m.label }));
}

// Kosakata verdict dipakai bersama sub-tab Offline & Online (ide #5c).
const VERDICT_META = {
  match: {
    label: "Match",
    pill: "bg-green-500/15 text-green-600 dark:text-green-400 border-green-500/30",
  },
  mismatch: {
    label: "Mismatch",
    pill: "bg-red-500/15 text-red-500 border-red-500/30",
  },
  uncertain: {
    label: "Uncertain",
    pill: "bg-yellow-500/15 text-yellow-600 dark:text-yellow-400 border-yellow-500/30",
  },
  insufficient_data: {
    label: "Insufficient data",
    pill: "bg-surface-3 text-text-muted border-border",
  },
};

// Label verdict rinci BazaarLink: identityAssessment.verdict.status (8 nilai
// kontrak). Label Inggris = source i18n; terjemahan Indonesia di id.json.
const ONLINE_DETAIL_VERDICT = {
  clean_match: {
    label: "Match",
    pill: "bg-green-500/15 text-green-600 dark:text-green-400 border-green-500/30",
  },
  clean_match_family_only: {
    label: "Family match only",
    pill: "bg-green-500/10 text-green-700 dark:text-green-300 border-green-500/20",
  },
  clean_match_submodel_mismatch: {
    label: "Submodel mismatch",
    pill: "bg-yellow-500/15 text-yellow-600 dark:text-yellow-400 border-yellow-500/30",
  },
  plain_mismatch: {
    label: "Mismatch",
    pill: "bg-red-500/15 text-red-500 border-red-500/30",
  },
  spoof_behavior_induced: {
    label: "Induced spoof behavior",
    pill: "bg-red-500/15 text-red-600 dark:text-red-400 border-red-500/30",
  },
  spoof_selfclaim_forged: {
    label: "Forged identity claim",
    pill: "bg-red-500/15 text-red-600 dark:text-red-400 border-red-500/30",
  },
  ambiguous: {
    label: "Ambiguous",
    pill: "bg-yellow-500/15 text-yellow-600 dark:text-yellow-400 border-yellow-500/30",
  },
  insufficient_data: {
    label: "Insufficient data",
    pill: "bg-surface-3 text-text-muted border-border",
  },
};

function VerdictBadge({ verdict, large }) {
  const meta = VERDICT_META[verdict] || VERDICT_META.uncertain;
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border font-semibold",
        meta.pill,
        large ? "px-4 py-1.5 text-base" : "px-2.5 py-0.5 text-xs"
      )}
    >
      {translate(meta.label)}
    </span>
  );
}

VerdictBadge.propTypes = {
  verdict: PropTypes.string,
  large: PropTypes.bool,
};

function formatConfidence(confidence) {
  if (confidence == null || Number.isNaN(confidence)) return "—";
  return `${Math.round(confidence * 100)}%`;
}

// Confidence BazaarLink bisa berupa angka 0–1 atau string high/medium/low.
function formatOnlineConfidence(confidence) {
  if (confidence == null) return "—";
  if (typeof confidence === "number" && !Number.isNaN(confidence)) {
    return `${Math.round(confidence * 100)}%`;
  }
  const s = String(confidence).trim();
  if (!s) return "—";
  return translate(s.charAt(0).toUpperCase() + s.slice(1).toLowerCase());
}

function formatTimestamp(ts) {
  if (!ts) return "—";
  const date = new Date(ts);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString();
}

function formatNumber(n) {
  if (n == null || Number.isNaN(n)) return "—";
  return n.toLocaleString("id-ID");
}

/**
 * Tombol "Copy JSON" dengan umpan balik "Copied!" sementara.
 */
function CopyJsonButton({ data }) {
  const [copied, setCopied] = useState(false);
  const timerRef = useRef(null);

  useEffect(() => () => clearTimeout(timerRef.current), []);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(JSON.stringify(data, null, 2));
      setCopied(true);
      clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => setCopied(false), 2000);
    } catch {
      // clipboard API bisa ditolak browser — abaikan, tidak fatal.
    }
  };

  return (
    <Button size="sm" variant="secondary" icon={copied ? "check" : "content_copy"} onClick={copy}>
      {copied ? translate("Copied!") : translate("Copy JSON")}
    </Button>
  );
}

CopyJsonButton.propTypes = {
  data: PropTypes.object,
};

function formatProbeMs(ms) {
  if (!Number.isFinite(ms) || ms < 0) return null;
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${Math.round(ms)}ms`;
}

/**
 * Satu baris tabel hasil probe online: label + badge grup + status.
 * Diklik untuk toggle collapse — detail (alasan, metrik waktu, token,
 * cuplikan respons) muncul di bawahnya. Tabel transparan: hanya
 * bottom-border antar baris, tanpa kotak luar.
 */
function OnlineProbeItemRow({ item, index }) {
  const [expanded, setExpanded] = useState(false);
  const label = item?.label || item?.probeId || `${translate("Probe")} ${index + 1}`;
  const group = typeof item?.group === "string" ? item.group : "";
  const passReason = typeof item?.passReason === "string" && item.passReason.trim() ? item.passReason.trim() : "";
  const error = item?.error ? String(item.error) : "";
  const detail = error || passReason;
  const ttft = formatProbeMs(item?.ttftMs);
  const duration = formatProbeMs(item?.durationMs);
  const tps = Number.isFinite(item?.tps) ? item.tps : null;
  const usage = item?.usage && typeof item.usage === "object" ? item.usage : null;
  const response = typeof item?.response === "string" && item.response ? item.response : "";
  const responsePreview = response.length > 600 ? `${response.slice(0, 600)}…` : response;

  const passed = item?.passed;
  const statusMeta =
    error || passed === false
      ? { text: translate("Failed"), cls: "text-red-500" }
      : passed === true
        ? { text: translate("Passed"), cls: "text-green-600 dark:text-green-400" }
        : passed === "warning"
          ? { text: translate("Warning"), cls: "text-amber-600 dark:text-amber-400" }
          : { text: translate("Skipped"), cls: "text-text-muted" };

  const metrics = [
    [translate("TTFT"), ttft],
    [translate("Duration"), duration],
    [translate("Speed"), tps != null ? `${tps.toFixed(1)} tps` : null],
    [translate("Input tokens"), usage?.promptTokens ?? item?.inputTokens ?? null],
    [translate("Output tokens"), usage?.completionTokens ?? item?.outputTokens ?? null],
    [translate("Finish reason"), item?.finishReason || null],
  ].filter(([, v]) => v != null && v !== "");

  return (
    <div className="border-b border-border-subtle last:border-b-0">
      <button
        type="button"
        onClick={() => setExpanded((e) => !e)}
        aria-expanded={expanded}
        className="flex w-full cursor-pointer items-center justify-between gap-2 px-1 py-2 text-left transition-colors hover:bg-surface-2/50"
      >
        <span className="flex min-w-0 flex-1 items-center gap-1.5">
          <span className="material-symbols-outlined shrink-0 text-[18px] text-text-muted" aria-hidden="true">
            {expanded ? "expand_less" : "expand_more"}
          </span>
          {group && (
            <span className="shrink-0 rounded border border-border-subtle px-1 py-px text-[10px] uppercase tracking-wide text-text-muted">
              {group}
            </span>
          )}
          <span className="truncate text-sm text-text-main" title={`${label}${item?.probeId && item.label ? ` (${item.probeId})` : ""}`}>
            {label}
          </span>
        </span>
        <span className={`shrink-0 text-xs font-medium ${statusMeta.cls}`}>{statusMeta.text}</span>
      </button>
      {expanded && (
        <div className="flex flex-col gap-2 px-1 pb-3 pl-8">
          {item?.neutral && (
            <p className="text-xs text-text-muted italic">{translate("Neutral control probe — not scored.")}</p>
          )}
          {detail && (
            <p className="whitespace-pre-wrap break-words text-xs text-text-main">{detail}</p>
          )}
          {metrics.length > 0 && (
            <dl className="grid grid-cols-2 gap-x-4 gap-y-1 sm:grid-cols-3">
              {metrics.map(([k, v]) => (
                <div key={k} className="flex items-baseline justify-between gap-2 text-xs">
                  <dt className="shrink-0 text-text-muted">{k}</dt>
                  <dd className="truncate font-mono text-text-main" title={String(v)}>{String(v)}</dd>
                </div>
              ))}
            </dl>
          )}
          {responsePreview && (
            <div className="flex flex-col gap-1">
              <p className="text-[11px] font-medium uppercase tracking-wide text-text-muted">{translate("Response preview")}</p>
              <p className="whitespace-pre-wrap break-words rounded-[8px] bg-surface-2 p-2 text-xs text-text-main">
                {responsePreview}
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

OnlineProbeItemRow.propTypes = {
  item: PropTypes.object,
  index: PropTypes.number.isRequired,
};

function ErrorBanner({ message, onRetry }) {
  if (!message) return null;
  return (
    <div className="mb-3 flex flex-col gap-2 rounded-[10px] border border-red-500/40 bg-red-500/10 p-3 sm:flex-row sm:items-center sm:justify-between">
      <p className="text-sm text-red-500 break-words">{message}</p>
      {onRetry && (
        <Button size="sm" variant="secondary" onClick={onRetry}>
          {translate("Try Again")}
        </Button>
      )}
    </div>
  );
}

ErrorBanner.propTypes = {
  message: PropTypes.string,
  onRetry: PropTypes.func,
};

function FlagPills({ flags }) {
  const FLAG_LABELS = {
    billing_anomaly: "Billing anomaly",
    transport_anomaly: "Transport anomaly",
    backend_rotation: "Backend rotation",
  };
  const active = Object.keys(FLAG_LABELS).filter((key) => flags?.[key]);
  if (active.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-2">
      {active.map((key) => (
        <span
          key={key}
          className="rounded-full border border-yellow-500/40 bg-yellow-500/15 px-2.5 py-0.5 text-xs font-medium text-yellow-600 dark:text-yellow-400"
        >
          {translate(FLAG_LABELS[key])}
        </span>
      ))}
    </div>
  );
}

FlagPills.propTypes = {
  flags: PropTypes.object,
};

/* ------------------------------------------------------------------ */
/* Sub-tab Offline                                                     */
/* ------------------------------------------------------------------ */

const OFFLINE_PROGRESS_TOTAL = 13;

function OfflineProbePanel({ modelOptions, connectionOptions }) {
  const [modelId, setModelId] = useState("");
  const [connectionId, setConnectionId] = useState("");
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: OFFLINE_PROGRESS_TOTAL });
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");
  const [expandedGroups, setExpandedGroups] = useState({});
  const pollTimerRef = useRef(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      clearInterval(pollTimerRef.current);
    };
  }, []);

  const hasConnection = connectionOptions.length > 0;
  const canRun = modelId && connectionId && !running && hasConnection;

  const runProbe = async () => {
    if (!canRun) return;
    const clientRunId =
      typeof crypto !== "undefined" && crypto.randomUUID
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    setRunning(true);
    setError("");
    setProgress({ done: 0, total: OFFLINE_PROGRESS_TOTAL });

    // Polling progres berjalan paralel dengan request POST utama.
    const pollProgress = async () => {
      try {
        const res = await fetch(`/api/probe/offline/progress?runId=${encodeURIComponent(clientRunId)}`);
        if (!res.ok) return;
        const data = await res.json().catch(() => ({}));
        if (mountedRef.current && typeof data?.done === "number") {
          setProgress({ done: data.done, total: data.total ?? OFFLINE_PROGRESS_TOTAL });
        }
      } catch {
        // Error polling progres bukan fatal — progres hanya tampilan.
      }
    };
    pollProgress();
    pollTimerRef.current = setInterval(pollProgress, 1000);

    try {
      const res = await fetch("/api/probe/offline", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ connectionId, modelId, clientRunId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || `${translate("Probe failed")} (${res.status})`);
      if (mountedRef.current) {
        setResult(data);
        setExpandedGroups({});
      }
    } catch (err) {
      // Hasil sebelumnya (bila ada) tetap tampil — hanya tambah banner error.
      if (mountedRef.current) setError(err?.message || translate("Probe failed"));
    } finally {
      clearInterval(pollTimerRef.current);
      if (mountedRef.current) setRunning(false);
    }
  };

  const toggleGroup = (groupId) =>
    setExpandedGroups((prev) => ({ ...prev, [groupId]: !prev[groupId] }));

  const summary = result?.summary || {};
  const metrics = result?.metrics || {};
  const meta = result?.meta || {};
  const totalTokens = metrics.totalTokens || {};
  const groups = Array.isArray(result?.groups) ? result.groups : [];

  const evidenceFor = (groupId) => {
    const evidence = result?.evidence;
    if (!evidence || typeof evidence !== "object") return null;
    return evidence[groupId] ?? null;
  };

  return (
    <div>
      {/* Form: model + koneksi + tombol jalan */}
      <div className="mb-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <SearchableSelect
          label={translate("Model")}
          options={modelOptions}
          value={modelId}
          onChange={setModelId}
          placeholder={translate("Select model...")}
          disabled={running || modelOptions.length === 0}
          required
        />
        <SearchableSelect
          label={translate("Connection")}
          options={connectionOptions}
          value={connectionId}
          onChange={setConnectionId}
          placeholder={translate("Select connection...")}
          disabled={running || !hasConnection}
          required
          hint={
            hasConnection
              ? translate("The API key comes from the saved connection — it is not entered manually.")
              : undefined
          }
        />
      </div>

      {!hasConnection && (
        <p className="mb-3 rounded-[10px] border border-dashed border-border p-4 text-center text-sm text-text-muted">
          {translate("Add an active connection first")}
        </p>
      )}

      <div className="mb-4 flex items-center gap-3">
        <Button size="sm" icon="play_arrow" onClick={runProbe} disabled={!canRun} loading={running}>
          {running ? translate("Running...") : translate("Run Probe")}
        </Button>
        {running && (
          <p className="text-sm text-text-muted" role="status" aria-live="polite">
            {translate("Running probe… ({done}/{total})")
              .replace("{done}", String(progress.done))
              .replace("{total}", String(progress.total))}
          </p>
        )}
      </div>

      <ErrorBanner message={error} onRetry={canRun ? runProbe : null} />

      {/* Empty state awal */}
      {!result && !running && (
        <div className="rounded-[10px] border border-dashed border-border p-8 text-center">
          <p className="mb-1 text-3xl" aria-hidden="true">🔍</p>
          <p className="mb-1 text-sm font-medium text-text-main">
            {translate("No probe results yet")}
          </p>
          <p className="mx-auto max-w-md text-sm text-text-muted">
            {translate(
              "Select a model and connection above, then run the probe to verify model authenticity — about 13 calls, done in under 1 minute."
            )}
          </p>
        </div>
      )}

      {/* Hasil */}
      {result && (
        <div className="flex flex-col gap-4">
          {/* Header status */}
          <div className="flex flex-wrap items-center gap-3">
            <h3 className="text-base font-semibold text-text-main">
              {translate("Model Identity Probe")}
            </h3>
            <VerdictBadge verdict={result.verdict} large />
            <span className="text-sm text-text-muted">
              {translate("Confidence")}: {formatConfidence(result.confidence)}
            </span>
            <span className="ml-auto flex items-center gap-2">
              <span className="text-xs text-text-muted">{formatTimestamp(meta.timestamp)}</span>
              <Button size="sm" variant="secondary" onClick={runProbe} disabled={!canRun}>
                {translate("Re-run Probe")}
              </Button>
            </span>
          </div>

          {/* Ringkasan 4 kolom */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <MetricCard label={translate("Claimed Model")} value={summary.claimedModel || modelId || "—"} />
            <MetricCard
              label={translate("Predicted Family")}
              value={summary.predictedFamily || "—"}
              sub={formatConfidence(summary.predictedFamilyConfidence)}
            />
            <MetricCard
              label={translate("Predicted Submodel")}
              value={summary.predictedSubmodel || "—"}
              sub={formatConfidence(summary.predictedSubmodelConfidence)}
            />
            <MetricCard label={translate("Summary")} value={summary.conclusion || "—"} />
          </div>

          {/* Grup probe */}
          {groups.length > 0 && (
            <div className="flex flex-col gap-2">
              {groups.map((group, index) => {
                const groupId = group?.id || `group-${index}`;
                const evidence = evidenceFor(group?.id);
                return (
                  <ProbeGroupRow
                    key={groupId}
                    group={group}
                    expanded={!!expandedGroups[groupId]}
                    onToggle={() => toggleGroup(groupId)}
                  >
                    {evidence != null && (
                      <pre className="mt-2 max-h-60 overflow-auto rounded-lg bg-black/[0.04] p-2 text-xs text-text-main dark:bg-white/[0.05]">
                        {typeof evidence === "string" ? evidence : JSON.stringify(evidence, null, 2)}
                      </pre>
                    )}
                  </ProbeGroupRow>
                );
              })}
            </div>
          )}

          {/* Kartu metrik */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <MetricCard
              label="TTFT"
              value={metrics.ttftMs != null ? `${Math.round(metrics.ttftMs)} ms` : "—"}
            />
            <MetricCard
              label="TPS"
              value={metrics.tps != null ? Number(metrics.tps).toFixed(1) : "—"}
            />
            <MetricCard
              label={translate("Total latency")}
              value={metrics.totalLatencyMs != null ? `${Math.round(metrics.totalLatencyMs)} ms` : "—"}
            />
            <MetricCard
              label={translate("Total tokens")}
              value={`${formatNumber(totalTokens.input)} / ${formatNumber(totalTokens.output)}`}
              sub={translate("in / out")}
            />
          </div>

          <WarningList warnings={result.warnings} />

          <FlagPills flags={result.flags} />

          {/* Footer meta + salin JSON */}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-border-subtle pt-3 text-xs text-text-muted">
            <span>
              {translate("Duration")}: {meta.durationMs != null ? `${Math.round(meta.durationMs / 1000)} dtk` : "—"}
            </span>
            <span>
              {translate("Calls")}: {meta.callsMade ?? "—"}/{meta.callsTotal ?? "—"}
            </span>
            <span className="ml-auto">
              <CopyJsonButton data={result} />
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

OfflineProbePanel.propTypes = {
  modelOptions: PropTypes.arrayOf(
    PropTypes.shape({ value: PropTypes.string.isRequired, label: PropTypes.string.isRequired })
  ).isRequired,
  connectionOptions: PropTypes.arrayOf(
    PropTypes.shape({ value: PropTypes.string.isRequired, label: PropTypes.string.isRequired })
  ).isRequired,
};

/* ------------------------------------------------------------------ */
/* Sub-tab Online                                                       */
/* ------------------------------------------------------------------ */

// Status run terminal BazaarLink — polling berhenti.
const ONLINE_TERMINAL = new Set(["completed", "failed", "aborted", "expired"]);
const ONLINE_POLL_INTERVAL_MS = 7000;
const ONLINE_MAX_POLLS = 260; // ±30 menit @ 7 dtk per kontrak

function OnlineProbePanel({ modelOptions, connectionOptions }) {
  const [modelId, setModelId] = useState("");
  const [connectionId, setConnectionId] = useState("");
  const [consent, setConsent] = useState(false);
  const [bazaarApiKey, setBazaarApiKey] = useState("");
  const [running, setRunning] = useState(false);
  const [runId, setRunId] = useState("");
  // pollToken dari route start — TIDAK ditampilkan ke user, hanya dikirim
  // sebagai query param saat polling. Dikosongkan saat run selesai/batal.
  const [pollToken, setPollToken] = useState("");
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");
  const [rateLimitSeconds, setRateLimitSeconds] = useState(0);
  const pollTimerRef = useRef(null);
  const countdownTimerRef = useRef(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      clearInterval(pollTimerRef.current);
      clearInterval(countdownTimerRef.current);
    };
  }, []);

  // Countdown rate limit dari retryAfterSeconds (429) — tanpa auto-retry.
  useEffect(() => {
    if (rateLimitSeconds <= 0) {
      clearInterval(countdownTimerRef.current);
      return;
    }
    countdownTimerRef.current = setInterval(() => {
      setRateLimitSeconds((s) => (s > 0 ? s - 1 : 0));
    }, 1000);
    return () => clearInterval(countdownTimerRef.current);
  }, [rateLimitSeconds > 0]); // eslint-disable-line react-hooks/exhaustive-deps

  const hasConnection = connectionOptions.length > 0;
  const rateLimited = rateLimitSeconds > 0;
  const canRun =
    modelId && connectionId && consent && !running && !rateLimited && hasConnection;

  const stopPolling = () => clearInterval(pollTimerRef.current);

  const pollOnline = (id, token) => {
    let polls = 0;
    pollTimerRef.current = setInterval(async () => {
      polls += 1;
      try {
        const qs = token ? `?token=${encodeURIComponent(token)}` : "";
        const res = await fetch(`/api/probe/online/${encodeURIComponent(id)}${qs}`);
        if (res.status === 404) {
          // Run kedaluwarsa (TTL 30 menit di sisi BazaarLink).
          stopPolling();
          if (mountedRef.current) {
            setRunning(false);
            setPollToken("");
            setError(translate("Results expired, run again"));
          }
          return;
        }
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data?.error || `${translate("Failed to fetch results")} (${res.status})`);
        const status = String(data?.status || "");
        if (ONLINE_TERMINAL.has(status) || VERDICT_META[status]) {
          stopPolling();
          if (mountedRef.current) {
            setResult(data);
            setRunning(false);
            setPollToken("");
          }
          return;
        }
        if (polls >= ONLINE_MAX_POLLS) {
          stopPolling();
          if (mountedRef.current) {
            setRunning(false);
            setPollToken("");
            setError(translate("Polling stopped: 30-minute limit reached"));
          }
        }
      } catch (err) {
        stopPolling();
        if (mountedRef.current) {
          setRunning(false);
          setPollToken("");
          setError(err?.message || translate("Failed to fetch results"));
        }
      }
    }, ONLINE_POLL_INTERVAL_MS);
  };

  const runOnline = async () => {
    if (!canRun) return;
    setRunning(true);
    setError("");
    setResult(null);
    setPollToken("");
    try {
      const res = await fetch("/api/probe/online", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          connectionId,
          modelId,
          // Opsional: kosong = server pakai BAZAARLINK_API_KEY dari env.
          bazaarApiKey: bazaarApiKey.trim(),
          claimedModel: modelId,
        }),
      });
      // Key tidak disimpan di mana pun — kosongkan segera setelah submit.
      setBazaarApiKey("");
      const data = await res.json().catch(() => ({}));
      if (res.status === 429) {
        const retryAfter = Number(data?.retryAfterSeconds) || 60;
        if (mountedRef.current) {
          setRateLimitSeconds(retryAfter);
          setError(data?.error || translate("Rate limit reached"));
          setRunning(false);
        }
        return;
      }
      if (!res.ok || !data?.runId) {
        throw new Error(data?.error || `${translate("Online probe failed")} (${res.status})`);
      }
      if (mountedRef.current) {
        setRunId(data.runId);
        const token = typeof data?.pollToken === "string" ? data.pollToken : "";
        setPollToken(token);
        pollOnline(data.runId, token);
      }
    } catch (err) {
      if (mountedRef.current) {
        setRunning(false);
        setError(err?.message || translate("Online probe failed"));
      }
    }
  };

  // Render defensif: struktur mengikuti kontrak BazaarLink, field bisa tidak ada.
  // Hasil resmi memakai identityAssessment (BUKAN field root verdict/confidence).
  const detail = result?.detail && typeof result.detail === "object" ? result.detail : {};
  const identityAssessment =
    result?.identityAssessment && typeof result.identityAssessment === "object"
      ? result.identityAssessment
      : null;
  const iaVerdict =
    identityAssessment?.verdict && typeof identityAssessment.verdict === "object"
      ? identityAssessment.verdict
      : null;
  // Status luar untuk badge: match/mismatch/uncertain/insufficient_data.
  const verdict = identityAssessment?.status || result?.status || result?.verdict || "";
  // Verdict rinci kontrak (8 nilai) — dilabeli via ONLINE_DETAIL_VERDICT.
  const detailedVerdictStatus = iaVerdict?.status || "";
  const detailedVerdictMeta = ONLINE_DETAIL_VERDICT[detailedVerdictStatus] || null;
  const confidence = iaVerdict?.confidence ?? result?.confidence ?? detail.confidence;
  const reasoning =
    (Array.isArray(iaVerdict?.reasoning) ? iaVerdict.reasoning.join("\n") : iaVerdict?.reasoning) ||
    result?.reasoning ||
    detail.reasoning ||
    result?.summary;
  const warnings = Array.isArray(result?.warnings) ? result.warnings : [];
  const items = Array.isArray(result?.items) ? result.items : [];
  const inputTokens =
    result?.totalInputTokens ?? result?.tokenTotals?.input ?? detail.totalInputTokens;
  const outputTokens =
    result?.totalOutputTokens ?? result?.tokenTotals?.output ?? detail.totalOutputTokens;
  // null = belum diketahui; jangan tampilkan kandidat sementara sebagai identitas pasti.
  const trueFamily = iaVerdict?.trueFamily ?? detail.trueFamily ?? result?.trueFamily ?? null;
  const trueModel = iaVerdict?.trueModel ?? detail.trueModel ?? result?.trueModel ?? null;
  const claimedModel = result?.claimedModel || detail.claimedModel || null;
  // Link laporan resmi BazaarLink (base URL dari config terpusat).
  const reportUrl = typeof result?.reportUrl === "string" ? result.reportUrl : "";
  const reportHref = reportUrl
    ? (reportUrl.startsWith("http") ? reportUrl : `${PROBE.online.bazaarBaseUrl}${reportUrl}`)
    : "";

  return (
    <div>
      <div className="mb-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <SearchableSelect
          label={translate("Model")}
          options={modelOptions}
          value={modelId}
          onChange={setModelId}
          placeholder={translate("Select model...")}
          disabled={running || modelOptions.length === 0}
          required
        />
        <SearchableSelect
          label={translate("Connection")}
          options={connectionOptions}
          value={connectionId}
          onChange={setConnectionId}
          placeholder={translate("Select connection...")}
          disabled={running || !hasConnection}
          required
        />
      </div>

      {!hasConnection && (
        <p className="mb-3 rounded-[10px] border border-dashed border-border p-4 text-center text-sm text-text-muted">
          {translate("Add an active connection first")}
        </p>
      )}

      {/* API key BazaarLink: opsional — kosong = pakai key server (BAZAARLINK_API_KEY). */}
      <div className="mb-3 flex flex-col gap-1.5">
        <label className="text-sm font-medium text-text-main" htmlFor="probe-bazaar-key">
          {translate("BazaarLink API key")}
          <span className="text-xs text-text-muted ml-1">({translate("optional")})</span>
        </label>
        <input
          id="probe-bazaar-key"
          type="password"
          value={bazaarApiKey}
          onChange={(e) => setBazaarApiKey(e.target.value)}
          disabled={running}
          autoComplete="off"
          placeholder={translate("Leave empty to use the server key...")}
          className="w-full rounded-[10px] border border-transparent bg-surface-2 px-3 py-2.5 text-sm text-text-main focus:border-brand-500/40 focus:outline-none focus:ring-2 focus:ring-brand-500/30 disabled:opacity-50"
        />
        <p className="text-xs text-text-muted">
          {translate("Empty = server key from BAZAARLINK_API_KEY. A manually entered key is only used for this run and is not stored anywhere.")}
        </p>
      </div>

      {/* Consent wajib */}
      <label className="mb-3 flex cursor-pointer items-start gap-2.5 text-sm text-text-main">
        <input
          type="checkbox"
          checked={consent}
          onChange={(e) => setConsent(e.target.checked)}
          disabled={running}
          className="mt-0.5 h-4 w-4 shrink-0 accent-brand-500"
        />
        <span>
          {translate(
            "I agree to run the probe via BazaarLink. One run = 84 standard tests + 2 optional; the number of requests and upstream cost vary (preflight, retries, sampling). A disposable key that is revoked afterwards is recommended."
          )}
        </span>
      </label>

      <div className="mb-4 flex items-center gap-3">
        <Button size="sm" icon="play_arrow" onClick={runOnline} disabled={!canRun} loading={running}>
          {running ? translate("Running...") : translate("Run Probe")}
        </Button>
        {running && (
          <p className="text-sm text-text-muted" role="status" aria-live="polite">
            {translate("Running online probe…")}
            {runId && <span className="ml-1 font-mono text-xs">{runId}</span>}
          </p>
        )}
        {rateLimited && (
          <p className="text-sm text-yellow-600 dark:text-yellow-400" role="status" aria-live="polite">
            {translate("Rate limit: retry in {n}s").replace("{n}", String(rateLimitSeconds))}
          </p>
        )}
      </div>

      <ErrorBanner message={error} onRetry={canRun && !rateLimited ? runOnline : null} />

      {/* Empty state awal */}
      {!result && !running && (
        <div className="rounded-[10px] border border-dashed border-border p-8 text-center">
          <p className="mb-1 text-3xl" aria-hidden="true">🌐</p>
          <p className="mb-1 text-sm font-medium text-text-main">
            {translate("Online probe via BazaarLink")}
          </p>
          <p className="mx-auto max-w-md text-sm text-text-muted">
            {translate(
              "84 standard tests + 2 optional, with official baseline for high confidence. Slower than Offline, but far more comprehensive."
            )}
          </p>
        </div>
      )}

      {/* Hasil online */}
      {result && (
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center gap-3">
            <h3 className="text-base font-semibold text-text-main">
              {translate("Online Probe Results")}
            </h3>
            {verdict && <VerdictBadge verdict={verdict} large />}
            {detailedVerdictMeta && (
              <span
                className={cn(
                  "inline-flex items-center rounded-full border px-3 py-1 text-sm font-medium",
                  detailedVerdictMeta.pill
                )}
              >
                {translate(detailedVerdictMeta.label)}
              </span>
            )}
            <span className="text-sm text-text-muted">
              {translate("Confidence")}: {formatOnlineConfidence(confidence)}
            </span>
            {claimedModel && (
              <span className="text-sm text-text-muted">
                {translate("Claimed")}: <span className="font-mono text-xs text-text-main">{claimedModel}</span>
              </span>
            )}
            <span className="ml-auto flex items-center gap-2">
              {reportHref && (
                <a
                  href={reportHref}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline"
                >
                  <span className="material-symbols-outlined text-[16px]">open_in_new</span>
                  {translate("View full report")}
                </a>
              )}
              <CopyJsonButton data={result} />
            </span>
          </div>

          {reasoning && (
            <p className="text-sm text-text-main whitespace-pre-wrap break-words">{reasoning}</p>
          )}

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <MetricCard label={translate("Detected family")} value={trueFamily || translate("Unknown")} />
            <MetricCard label={translate("Detected model")} value={trueModel || translate("Unknown")} />
          </div>

          {/* Total token sebagai bukti biaya */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <MetricCard label={translate("Input tokens")} value={formatNumber(inputTokens)} />
            <MetricCard label={translate("Output tokens")} value={formatNumber(outputTokens)} />
            <MetricCard label={translate("Probe count")} value={items.length > 0 ? formatNumber(items.length) : "—"} />
          </div>

          <WarningList warnings={warnings} />

          {/* Per-item error tetap ditampilkan bila run completed (kontrak BazaarLink). */}
          {items.length > 0 && (
            <div className="flex flex-col gap-1">
              <h4 className="text-sm font-medium text-text-main">
                {translate("Per-probe results")}{" "}
                <span className="font-normal text-text-muted">({formatNumber(items.length)})</span>
              </h4>
              <div className="flex items-center justify-between border-b border-border-subtle px-1 pb-1 text-[11px] font-medium uppercase tracking-wide text-text-muted">
                <span>{translate("Probe")}</span>
                <span>{translate("Status")}</span>
              </div>
              <div>
                {items.map((item, index) => (
                  <OnlineProbeItemRow key={item?.probeId || index} item={item} index={index} />
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

OnlineProbePanel.propTypes = {
  modelOptions: PropTypes.arrayOf(
    PropTypes.shape({ value: PropTypes.string.isRequired, label: PropTypes.string.isRequired })
  ).isRequired,
  connectionOptions: PropTypes.arrayOf(
    PropTypes.shape({ value: PropTypes.string.isRequired, label: PropTypes.string.isRequired })
  ).isRequired,
};

/* ------------------------------------------------------------------ */
/* Container tab Probe                                                 */
/* ------------------------------------------------------------------ */

const PROBE_TABS = [
  { id: "offline", label: "Offline", Component: OfflineProbePanel },
  { id: "online", label: "Online", Component: OnlineProbePanel },
];

/**
 * Tab "Probe" di PlaygroundSection — dipasang sebagai entri config-driven
 * di TABS (bukan section terpisah di page.js, agar tidak double-render).
 * Props tambahan dari tabProps (mis. apiKey) diabaikan.
 */
export default function ProbeSection({ providerId, providerAlias, models, customModels, disabledModelIds, connections }) {
  const [activeSubTab, setActiveSubTab] = useState("offline");

  const modelOptions = buildModelOptions(models, customModels, disabledModelIds, providerAlias, providerId);
  const connectionOptions = (connections || [])
    .filter((c) => c && c.isActive !== false)
    .map((c) => ({
      value: c.id,
      label: c.displayName || c.name || c.email || c.id,
    }));

  const ActivePanel = PROBE_TABS.find((t) => t.id === activeSubTab)?.Component || OfflineProbePanel;

  return (
    <div>
      <div className="mb-4 flex gap-1 self-start rounded-lg border border-border p-1" role="tablist" aria-label={translate("Probe")}>
        {PROBE_TABS.map(({ id, label }) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={activeSubTab === id}
            onClick={() => setActiveSubTab(id)}
            className={cn(
              "rounded-md px-3 py-1 text-sm transition-colors",
              activeSubTab === id
                ? "bg-primary/15 text-text-main font-medium"
                : "text-text-muted hover:text-text-main"
            )}
          >
            {translate(label)}
          </button>
        ))}
      </div>

      <ActivePanel modelOptions={modelOptions} connectionOptions={connectionOptions} />
    </div>
  );
}

ProbeSection.propTypes = {
  providerId: PropTypes.string.isRequired,
  providerAlias: PropTypes.string.isRequired,
  models: PropTypes.arrayOf(PropTypes.object),
  customModels: PropTypes.arrayOf(PropTypes.object),
  disabledModelIds: PropTypes.arrayOf(PropTypes.string),
  connections: PropTypes.arrayOf(PropTypes.object),
};
