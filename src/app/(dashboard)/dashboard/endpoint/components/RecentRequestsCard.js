"use client";

import { useState, useEffect, useCallback } from "react";
import { Card, Button } from "@/shared/components";
import { RECENT_REQUESTS_POLL_MS } from "../endpointConstants";
import {
  formatRelativeTime,
  requestStatusClass,
  requestStatusLabel,
  providerLabel,
} from "./recentRequestsFormat";

// 10 request terakhir dari endpoint yang sudah ada (payload percakapan
// sudah di-redact di sisi server — hanya metadata yang dikembalikan).
const PAGE_SIZE = 10;

async function fetchProviderNames() {
  const res = await fetch("/api/providers");
  if (!res.ok) return {};
  const data = await res.json();
  const map = {};
  for (const c of data.connections || []) {
    if (c?.provider && c?.name) map[c.provider] = c.name;
  }
  return map;
}

async function fetchRecentRequests() {
  const res = await fetch(`/api/usage/request-details?page=1&pageSize=${PAGE_SIZE}`, { cache: "no-store" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  return data.details || [];
}

/**
 * Panel "Request Terakhir" di halaman Home: 10 request terbaru
 * (waktu, provider, model, status, latensi), polling tiap 3 detik.
 * Fail-open: bila fetch gagal, data lama tetap tampil.
 */
export default function RecentRequestsCard() {
  const [requests, setRequests] = useState([]);
  const [providerNames, setProviderNames] = useState({});
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      setRequests(await fetchRecentRequests());
    } catch {
      // Fail-open: biarkan data lama, jangan kosongkan panel.
    } finally {
      setLoading(false);
    }
  }, []);

  // Pola fetch-on-mount + polling disengaja (lihat AGENTS.md) — jangan di-refactor.
  useEffect(() => {
    fetchProviderNames().then(setProviderNames).catch(() => {});
    // eslint-disable-next-line react-hooks/set-state-in-effect -- disengaja: fetch awal saat halaman dibuka; jangan di-refactor
    load();
    const timer = setInterval(() => {
      if (!document.hidden) load();
    }, RECENT_REQUESTS_POLL_MS);
    return () => clearInterval(timer);
  }, [load]);

  return (
    <Card>
      <div className="flex items-center justify-between mb-2">
        <h2 className="text-lg font-semibold flex items-center gap-2">
          <span className="material-symbols-outlined text-primary">history</span>
          Request Terakhir
        </h2>
        <Button size="sm" variant="ghost" icon="refresh" onClick={load}>
          Refresh
        </Button>
      </div>
      <p className="text-sm text-text-muted mb-4">
        10 request terbaru yang melewati gateway. Diperbarui otomatis setiap 3 detik.
      </p>

      {loading ? (
        <p className="text-sm text-text-muted flex items-center gap-2 py-6">
          <span className="material-symbols-outlined animate-spin text-sm">progress_activity</span>
          Memuat request...
        </p>
      ) : requests.length === 0 ? (
        <p className="text-sm text-text-muted text-center py-8">
          Belum ada request tercatat.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <div className="min-w-[600px]">
            <div className="grid grid-cols-12 gap-x-3 px-3 py-2 text-xs font-medium uppercase text-text-muted border-b border-border">
              <div className="col-span-2">Status</div>
              <div className="col-span-2">Waktu</div>
              <div className="col-span-3">Provider</div>
              <div className="col-span-3">Model</div>
              <div className="col-span-2 text-right">Latensi</div>
            </div>
            {requests.map((r) => (
              <div
                key={r.id || `${r.timestamp}|${r.model}`}
                className="grid grid-cols-12 gap-x-3 px-3 py-2.5 border-b border-black/[0.03] dark:border-white/[0.03] last:border-b-0 items-center"
              >
                <div className="col-span-2">
                  <span className="flex items-center gap-1.5 text-sm">
                    <span className={`size-2 rounded-full shrink-0 ${requestStatusClass(r.status)}`} />
                    <span className="text-text-muted">{requestStatusLabel(r.status)}</span>
                  </span>
                </div>
                <div
                  className="col-span-2 text-sm text-text-muted whitespace-nowrap"
                  title={r.timestamp ? new Date(r.timestamp).toLocaleString() : "—"}
                >
                  {formatRelativeTime(r.timestamp)}
                </div>
                <div className="col-span-3 text-sm truncate" title={providerLabel(r.provider, providerNames)}>
                  {providerLabel(r.provider, providerNames)}
                </div>
                <div className="col-span-3 text-sm font-mono truncate" title={r.model || "—"}>
                  {r.model || "—"}
                </div>
                <div
                  className="col-span-2 text-sm text-right font-mono whitespace-nowrap"
                  title={r.latency?.ttft != null ? `TTFT: ${r.latency.ttft} ms` : undefined}
                >
                  {r.latency?.total != null ? `${r.latency.total} ms` : "—"}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </Card>
  );
}
