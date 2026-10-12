"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { Button } from "@/shared/components";
import { translate } from "@/i18n/runtime";

// Polling ringan daftar entry (detik).
const POLL_INTERVAL_MS = 15000;

function formatTime(ts) {
  try {
    return new Date(ts).toLocaleString();
  } catch {
    return String(ts);
  }
}

function formatBytes(n) {
  if (!Number.isFinite(n) || n < 0) return "—";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

// Tampilkan method + path saja agar tabel ringkas.
function shortTarget(entry) {
  const url = entry?.url || "";
  try {
    const u = new URL(url);
    const path = (u.pathname || "/") + (u.search ? u.search : "");
    return `${entry.method || "POST"} ${path.length > 80 ? path.slice(0, 80) + "…" : path}`;
  } catch {
    const s = `${entry.method || "POST"} ${url}`;
    return s.length > 90 ? s.slice(0, 90) + "…" : s;
  }
}

function statusBadgeClass(status) {
  if (status >= 500) return "bg-red-500/15 text-red-500";
  if (status >= 400) return "bg-amber-500/15 text-amber-500";
  return "bg-black/[0.04] dark:bg-white/[0.08] text-text-muted";
}

// Label asal error: "provider" = server LLM yang mengembalikan error,
// "akanesia-router" = gateway kita yang gagal mendapatkan respons.
function originLabel(origin) {
  if (origin === "provider") return "provider";
  if (origin === "gateway") return "akanesia-router";
  return "—";
}

/**
 * Tab "Replay" (ide #7) — daftar request upstream yang gagal, bisa
 * di-expand untuk detail dan di-replay (dengan opsi edit body).
 * Header sensitif sudah di-redact saat capture; buffer tidak di-persist.
 */
export default function ReplayTab() {
  const [entries, setEntries] = useState([]);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [expandedId, setExpandedId] = useState(null);
  const [editingId, setEditingId] = useState(null);
  const [draftBody, setDraftBody] = useState("");
  const [replayingId, setReplayingId] = useState(null);
  const [results, setResults] = useState({});
  const [capacityMB, setCapacityMB] = useState("");
  const [savingCapacity, setSavingCapacity] = useState(false);
  const [filter, setFilter] = useState("");

  // Filter Replay: saring entry berdasarkan provider/model/status/URL/error.
  const filteredEntries = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return entries;
    return entries.filter((entry) =>
      [entry.provider, entry.model, entry.status, entry.method, entry.url, entry.error, entry.errorOrigin]
        .filter((v) => v !== undefined && v !== null && v !== "")
        .some((v) => String(v).toLowerCase().includes(q))
    );
  }, [entries, filter]);

  // "Filter aktif" = pengguna sedang memfilter (ada teks filter).
  const isFiltering = filter.trim() !== "";

  // Export to JSON: bila filter aktif → export data yang terfilter;
  // bila tidak → export semua data.
  const handleExport = useCallback(() => {
    const data = isFiltering ? filteredEntries : entries;
    const payload = {
      exportedAt: new Date().toISOString(),
      filtered: isFiltering,
      filter: isFiltering ? filter.trim() : null,
      count: data.length,
      entries: data,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `replay-log-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }, [entries, filteredEntries, isFiltering, filter]);

  const fetchEntries = useCallback(async () => {
    try {
      const res = await fetch("/api/replay-log", { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setEntries(data.entries || []);
      setStats(data.stats || null);
      if (data.stats?.maxBytes && capacityMB === "") {
        setCapacityMB(String(Math.round(data.stats.maxBytes / (1024 * 1024))));
      }
      setError("");
    } catch (e) {
      setError(e?.message || translate("Failed to load replay log"));
    } finally {
      setLoading(false);
    }
  }, [capacityMB]);

  // Fetch-on-open + polling ringan; pola setState di useEffect disengaja
  // (konvensi #10 AGENTS.md) — jangan di-refactor.
  useEffect(() => {
    fetchEntries();
    const timer = setInterval(fetchEntries, POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [fetchEntries]);

  const handleClear = async () => {
    if (!window.confirm(translate("Clear all replay entries?"))) return;
    try {
      await fetch("/api/replay-log", { method: "DELETE" });
      setEntries([]);
      setExpandedId(null);
      setEditingId(null);
      setResults({});
      fetchEntries();
    } catch (e) {
      setError(e?.message || translate("Failed to clear replay log"));
    }
  };

  const toggleExpand = (id) => {
    setExpandedId((prev) => (prev === id ? null : id));
    setEditingId(null);
  };

  const startEdit = (entry) => {
    setEditingId(entry.id);
    setDraftBody(entry.requestBody || "{}");
  };

  const runReplay = async (entry, useEdited) => {
    setReplayingId(entry.id);
    try {
      const res = await fetch(`/api/replay-log/${entry.id}/replay`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(useEdited ? { body: draftBody } : {}),
      });
      const data = await res.json().catch(() => ({}));
      setResults((prev) => ({ ...prev, [entry.id]: { ...data, httpOk: res.ok } }));
    } catch (e) {
      setResults((prev) => ({ ...prev, [entry.id]: { ok: false, error: e?.message || String(e) } }));
    } finally {
      setReplayingId(null);
    }
  };

  const saveCapacity = async () => {
    const mb = Number(capacityMB);
    if (!Number.isFinite(mb) || mb <= 0) {
      setError(translate("Capacity must be a positive number (MB)"));
      return;
    }
    setSavingCapacity(true);
    try {
      const res = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ replayLogMaxBytes: Math.floor(mb * 1024 * 1024) }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setError("");
      fetchEntries();
    } catch (e) {
      setError(e?.message || translate("Failed to save capacity"));
    } finally {
      setSavingCapacity(false);
    }
  };

  const expanded = filteredEntries.find((e) => e.id === expandedId) || null;
  const replayResult = expandedId ? results[expandedId] : null;

  return (
    <div className="p-4">
      {/* Toolbar */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Button size="sm" variant="outline" icon="refresh" onClick={fetchEntries} disabled={loading}>
          {translate("Refresh")}
        </Button>
        <Button size="sm" variant="outline" icon="delete" onClick={handleClear} disabled={entries.length === 0}>
          {translate("Clear")}
        </Button>
        <input
          type="text"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder={translate("Filter by provider, model, status...")}
          className="w-56 rounded-lg border border-border bg-background px-2 py-1 text-sm focus:border-primary focus:outline-none"
        />
        <Button
          size="sm"
          variant="outline"
          icon="download"
          onClick={handleExport}
          disabled={(isFiltering ? filteredEntries.length : entries.length) === 0}
          title={isFiltering ? translate("Export filtered entries to JSON") : translate("Export all entries to JSON")}
        >
          {translate("Export JSON")}
        </Button>
        <span className="text-xs text-text-muted">
          {stats ? `${stats.count} ${translate("entries")} · ${formatBytes(stats.bytesUsed)} / ${formatBytes(stats.maxBytes)}` : "—"}
          {isFiltering && ` · ${filteredEntries.length} / ${entries.length} ${translate("shown")}`}
        </span>
        <div className="ml-auto flex items-center gap-2">
          <label htmlFor="replay-capacity" className="text-xs text-text-muted">{translate("Capacity (MB)")}</label>
          <input
            id="replay-capacity"
            type="number"
            min="1"
            value={capacityMB}
            onChange={(e) => setCapacityMB(e.target.value)}
            className="w-20 rounded-lg border border-border bg-background px-2 py-1 text-sm focus:border-primary focus:outline-none"
          />
          <Button size="sm" variant="secondary" onClick={saveCapacity} disabled={savingCapacity}>
            {savingCapacity ? translate("Saving...") : translate("Save")}
          </Button>
        </div>
      </div>

      {error && <p className="mb-3 text-xs text-red-500 break-words">{error}</p>}

      {loading ? (
        <p className="py-8 text-center text-sm text-text-muted">{translate("Loading...")}</p>
      ) : entries.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-text-muted">
          {translate("No failed upstream requests captured yet.")}
        </p>
      ) : filteredEntries.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-text-muted">
          {translate("No entries match the current filter.")}
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-black/[0.03] dark:bg-white/[0.04] text-left">
                <th className="px-3 py-2 text-xs font-medium text-text-muted">{translate("Time")}</th>
                <th className="px-3 py-2 text-xs font-medium text-text-muted">{translate("Provider / Model")}</th>
                <th className="px-3 py-2 text-xs font-medium text-text-muted">{translate("Request")}</th>
                <th className="px-3 py-2 text-xs font-medium text-text-muted">{translate("Status")}</th>
                <th className="px-3 py-2 text-xs font-medium text-text-muted">{translate("Latency")}</th>
                <th className="px-3 py-2 text-xs font-medium text-text-muted"><span className="sr-only">{translate("Actions")}</span></th>
              </tr>
            </thead>
            <tbody>
              {filteredEntries.map((entry) => {
                const isOpen = entry.id === expandedId;
                return (
                  <tr
                    key={entry.id}
                    onClick={() => toggleExpand(entry.id)}
                    className={`cursor-pointer border-b border-border/60 hover:bg-black/[0.02] dark:hover:bg-white/[0.03] ${isOpen ? "bg-primary/5" : ""}`}
                  >
                    <td className="whitespace-nowrap px-3 py-2 text-xs text-text-muted">{formatTime(entry.ts)}</td>
                    <td className="px-3 py-2">
                      <span className="font-medium" title={entry.provider}>{entry.providerName || entry.provider}</span>
                      <span className="text-text-muted"> / </span>
                      <span className="text-xs text-text-muted">{entry.model}</span>
                    </td>
                    <td className="max-w-[280px] truncate px-3 py-2 font-mono text-xs" title={entry.url}>{shortTarget(entry)}</td>
                    <td className="px-3 py-2">
                      <span className={`rounded px-2 py-0.5 font-mono text-xs font-semibold ${statusBadgeClass(entry.status)}`}>
                        {entry.status || "—"}
                      </span>
                      <div className="mt-0.5 text-[10px] leading-tight text-text-muted" title={translate("Error origin: LLM provider server vs akanesia-router")}>
                        {originLabel(entry.errorOrigin)}
                      </div>
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-xs">{entry.latencyMs} ms</td>
                    <td className="px-3 py-2 text-right">
                      <Button
                        size="sm"
                        variant="secondary"
                        icon="replay"
                        onClick={(e) => { e.stopPropagation(); toggleExpand(entry.id); startEdit(entry); }}
                      >
                        {translate("Replay")}
                      </Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Detail entry yang di-expand */}
      {expanded && (
        <div className="mt-3 rounded-lg border border-border p-4">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-semibold" title={expanded.provider}>
              {expanded.providerName || expanded.provider} / {expanded.model}
              <span className="ml-2 font-mono text-xs font-normal text-text-muted">{expanded.id}</span>
            </h3>
            <div className="ml-auto flex gap-2">
              {editingId === expanded.id ? (
                <>
                  <Button
                    size="sm"
                    icon="send"
                    onClick={() => runReplay(expanded, true)}
                    disabled={replayingId === expanded.id}
                  >
                    {replayingId === expanded.id ? translate("Sending...") : translate("Send edited")}
                  </Button>
                  <Button size="sm" variant="secondary" onClick={() => setEditingId(null)}>
                    {translate("Cancel")}
                  </Button>
                </>
              ) : (
                <>
                  <Button size="sm" variant="secondary" icon="edit" onClick={() => startEdit(expanded)}>
                    {translate("Edit body")}
                  </Button>
                  <Button
                    size="sm"
                    icon="replay"
                    onClick={() => runReplay(expanded, false)}
                    disabled={replayingId === expanded.id}
                  >
                    {replayingId === expanded.id ? translate("Sending...") : translate("Replay as-is")}
                  </Button>
                </>
              )}
            </div>
          </div>

          {editingId === expanded.id && (
            <div className="mb-3">
              <label className="mb-1 block text-xs text-text-muted" htmlFor={`replay-edit-${expanded.id}`}>
                {translate("Request body (JSON, editable before replay)")}
              </label>
              <textarea
                id={`replay-edit-${expanded.id}`}
                value={draftBody}
                onChange={(e) => setDraftBody(e.target.value)}
                rows={10}
                spellCheck={false}
                className="w-full rounded-lg border border-border bg-background p-3 font-mono text-xs focus:border-primary focus:outline-none"
              />
            </div>
          )}

          <div className="grid gap-3 md:grid-cols-2">
            <div>
              <p className="mb-1 text-xs font-medium text-text-muted">{translate("Request headers (redacted)")}</p>
              <pre className="max-h-48 overflow-auto rounded-lg bg-black/[0.03] p-3 font-mono text-xs dark:bg-white/[0.04]">
                {JSON.stringify(expanded.requestHeaders || {}, null, 2)}
              </pre>
            </div>
            <div>
              <p className="mb-1 text-xs font-medium text-text-muted">
                {translate("Response / error")}
                {expanded.responseTruncated ? ` (${translate("truncated")})` : ""}
              </p>
              <pre className="max-h-48 overflow-auto rounded-lg bg-black/[0.03] p-3 font-mono text-xs dark:bg-white/[0.04] whitespace-pre-wrap break-words">
                {expanded.responseText || expanded.error || "—"}
              </pre>
            </div>
          </div>

          <div className="mt-3">
            <p className="mb-1 text-xs font-medium text-text-muted">
              {translate("Request body")}
              {expanded.requestBodyTruncated ? ` (${translate("truncated")})` : ""}
            </p>
            <pre className="max-h-64 overflow-auto rounded-lg bg-black/[0.03] p-3 font-mono text-xs dark:bg-white/[0.04] whitespace-pre-wrap break-words">
              {expanded.requestBody || "—"}
            </pre>
          </div>

          {/* Hasil replay */}
          {replayResult && (
            <div className="mt-3 rounded-lg border border-border p-3">
              <p className="mb-2 text-xs font-medium text-text-muted">{translate("Replay result")}</p>
              {replayResult.error && !replayResult.httpOk ? (
                <p className="text-xs text-red-500 break-words">{replayResult.error}</p>
              ) : (
                <>
                  <div className="mb-2 flex flex-wrap gap-3 text-xs">
                    <span>
                      {translate("Status")}:{" "}
                      <span className={`rounded px-2 py-0.5 font-mono font-semibold ${statusBadgeClass(replayResult.status)}`}>
                        {replayResult.status}
                      </span>
                    </span>
                    <span className="text-text-muted">{translate("Latency")}: {replayResult.latencyMs} ms</span>
                    <span className={`font-medium ${replayResult.ok ? "text-green-500" : "text-amber-500"}`}>
                      {replayResult.ok ? translate("Success") : translate("Upstream error")}
                    </span>
                  </div>
                  <pre className="max-h-64 overflow-auto rounded-lg bg-black/[0.03] p-3 font-mono text-xs dark:bg-white/[0.04] whitespace-pre-wrap break-words">
                    {replayResult.error || replayResult.snippet || "—"}
                    {replayResult.truncated ? `\n… (${translate("truncated")})` : ""}
                  </pre>
                </>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
