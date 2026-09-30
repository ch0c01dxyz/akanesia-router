"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import Link from "next/link";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { Card } from "@/shared/components";

const REFRESH_MS = 30000;

const fmtInt = (n) => new Intl.NumberFormat("en-US").format(Math.round(n || 0));
const fmtUsd = (n) => `$${(n || 0).toFixed(4)}`;
const fmtPct = (n) => `${(n || 0).toFixed(1)}%`;

function fmtUptime(seconds) {
  const s = Math.max(0, Math.floor(seconds || 0));
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s % 60}s`;
  return `${s}s`;
}

function fmtTime(ts) {
  try {
    return new Date(ts).toLocaleString("en-US", {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return String(ts || "");
  }
}

function fmtDay(ts) {
  try {
    return new Date(ts).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
    });
  } catch {
    return "";
  }
}

async function fetchJson(url) {
  const res = await fetch(url, { cache: "no-store" });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data?.error || `Request failed (${res.status})`);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

function StatTile({ label, value, sub, accent }) {
  return (
    <Card className="p-4">
      <p className="text-xs text-text-muted uppercase tracking-wide">{label}</p>
      <p className={`mt-1 text-2xl font-semibold ${accent || ""}`}>{value}</p>
      {sub && <p className="mt-1 text-xs text-text-muted">{sub}</p>}
    </Card>
  );
}

export default function HeadroomDashboardClient() {
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [health, setHealth] = useState(null);
  const [stats, setStats] = useState(null);
  const [history, setHistory] = useState(null);
  const [range, setRange] = useState("daily");

  const load = useCallback(async (initial = false) => {
    if (initial) setLoading(true);
    else setRefreshing(true);
    setError("");
    try {
      const [healthData, statsData, historyData] = await Promise.all([
        fetchJson("/api/headroom/proxy/health"),
        fetchJson("/api/headroom/proxy/stats"),
        fetchJson("/api/headroom/proxy/stats-history?history_mode=full"),
      ]);
      setHealth(healthData);
      setStats(statsData);
      setHistory(historyData);
    } catch (e) {
      setError(e.message || "Failed to load Headroom metrics");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    // Defer agar tidak setState sinkron di body effect (react-hooks/set-state-in-effect).
    const timer = setTimeout(() => load(true), 0);
    const id = setInterval(() => load(false), REFRESH_MS);
    return () => {
      clearTimeout(timer);
      clearInterval(id);
    };
  }, [load]);

  const running = health?.status === "healthy";

  const chartData = useMemo(() => {
    const series = history?.series?.[range];
    const points = Array.isArray(series) && series.length > 0 ? series : history?.history || [];
    return points.map((p) => ({
      label: range === "daily" ? fmtDay(p.timestamp) : fmtTime(p.timestamp),
      saved: p.tokens_saved ?? p.total_tokens_saved ?? 0,
      usd: p.compression_savings_usd ?? 0,
    }));
  }, [history, range]);

  const recentRows = useMemo(() => {
    const points = Array.isArray(history?.history) ? [...history.history] : [];
    return points.slice(-8).reverse();
  }, [history]);

  const lifetime = stats?.persistent_savings?.lifetime || {};
  const requests = stats?.requests || {};
  const tokens = stats?.tokens || {};
  const cost = stats?.cost || {};
  const cache = stats?.cache || {};
  const litellmAvailable = stats?.litellm_available !== false;

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-xl font-semibold flex items-center gap-2">
            <span className="material-symbols-outlined text-primary">monitoring</span>
            Headroom Dashboard
          </h1>
          <p className="text-sm text-text-muted mt-1">
            Compression metrics from the Headroom proxy · auto-refreshes every 30s
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href="/dashboard/token-saver"
            className="rounded border border-border px-4 py-2 text-sm hover:bg-surface-2"
          >
            ← Token Saver
          </Link>
          <button
            type="button"
            onClick={() => load(false)}
            disabled={refreshing || loading}
            className="rounded border border-border px-4 py-2 text-sm hover:bg-surface-2 disabled:opacity-50 inline-flex items-center gap-2"
          >
            {refreshing && (
              <span className="inline-block w-3 h-3 rounded-full border-2 border-current border-t-transparent animate-spin" aria-hidden="true" />
            )}
            Refresh
          </button>
        </div>
      </div>

      {loading ? (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4" aria-hidden="true">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="rounded border border-border p-4">
              <div className="h-3 w-20 rounded bg-surface-2 animate-pulse" />
              <div className="mt-2 h-7 w-28 rounded bg-surface-2 animate-pulse" />
            </div>
          ))}
          <div className="col-span-2 lg:col-span-4 h-64 rounded border border-border bg-surface-2 animate-pulse" />
        </div>
      ) : error || !running ? (
        <Card className="p-8 text-center">
          <span className="material-symbols-outlined text-warning text-4xl">warning</span>
          <p className="mt-3 font-medium">Headroom proxy is not reachable</p>
          <p className="mt-1 text-sm text-text-muted">
            {error || "Start the Headroom proxy from the Token Saver page to see metrics here."}
          </p>
          <Link
            href="/dashboard/token-saver"
            className="mt-4 inline-block rounded bg-primary px-4 py-2 text-sm text-white hover:opacity-90"
          >
            Open Token Saver Setup
          </Link>
        </Card>
      ) : (
        <>
          <div className="flex items-center gap-3 flex-wrap text-sm">
            <span
              className={`inline-flex items-center gap-1.5 text-xs px-2 py-0.5 rounded ${
                running ? "bg-success/15 text-success" : "bg-warning/15 text-warning"
              }`}
            >
              <span className={`w-2 h-2 rounded-full ${running ? "bg-success" : "bg-warning"}`} />
              {running ? "Running" : "Stopped"}
            </span>
            {health?.version && (
              <span className="text-text-muted">v{health.version}</span>
            )}
            {typeof health?.uptime_seconds === "number" && (
              <span className="text-text-muted">uptime {fmtUptime(health.uptime_seconds)}</span>
            )}
          </div>

          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <StatTile
              label="Requests"
              value={fmtInt(requests.total)}
              sub={`${fmtInt(requests.cached)} cached · ${fmtInt(requests.failed)} failed · ${fmtInt(requests.rate_limited)} rate-limited`}
            />
            <StatTile
              label="Tokens saved"
              value={fmtInt(lifetime.tokens_saved ?? tokens.saved)}
              sub={`${fmtPct(tokens.savings_percent)} savings · ${fmtInt(tokens.input)} in / ${fmtInt(tokens.output)} out`}
              accent="text-success"
            />
            <StatTile
              label="$ Saved"
              value={fmtUsd(lifetime.compression_savings_usd ?? cost.total_savings_usd)}
              sub={
                litellmAvailable
                  ? `total cost ${fmtUsd(cost.total_cost_usd)}`
                  : "pricing unavailable — reinstall on Python 3.13 for USD figures"
              }
              accent="text-success"
            />
            <StatTile
              label="Cache"
              value={fmtInt(cache.total_hits)}
              sub={`${fmtInt(cache.entries)} entries`}
            />
          </div>

          <Card className="p-4">
            <div className="flex items-center justify-between gap-3 flex-wrap mb-3">
              <h2 className="font-medium">Tokens saved over time</h2>
              <div className="flex items-center gap-1 text-xs">
                {["daily", "weekly", "monthly"].map((r) => (
                  <button
                    key={r}
                    type="button"
                    onClick={() => setRange(r)}
                    className={`px-3 py-1 rounded capitalize ${
                      range === r
                        ? "bg-primary text-white"
                        : "border border-border hover:bg-surface-2"
                    }`}
                  >
                    {r}
                  </button>
                ))}
                <Link
                  href="/api/headroom/proxy/stats-history?format=csv&series=daily"
                  download="headroom-daily.csv"
                  className="ml-2 px-3 py-1 rounded border border-border hover:bg-surface-2 inline-flex items-center gap-1"
                  title="Download daily history as CSV"
                >
                  <span className="material-symbols-outlined text-sm">download</span>
                  CSV
                </Link>
              </div>
            </div>
            {chartData.length === 0 ? (
              <p className="text-sm text-text-muted py-12 text-center">
                No compression history yet — route some requests through Headroom first.
              </p>
            ) : (
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={chartData} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" opacity={0.4} />
                    <XAxis dataKey="label" tick={{ fontSize: 11 }} stroke="var(--color-text-muted)" />
                    <YAxis
                      tick={{ fontSize: 11 }}
                      stroke="var(--color-text-muted)"
                      tickFormatter={(v) =>
                        v >= 1000000 ? `${(v / 1000000).toFixed(1)}M` : v >= 1000 ? `${(v / 1000).toFixed(1)}K` : v
                      }
                    />
                    <Tooltip
                      contentStyle={{
                        background: "var(--color-surface)",
                        border: "1px solid var(--color-border)",
                        borderRadius: 8,
                        fontSize: 12,
                      }}
                      formatter={(value, name) =>
                        name === "usd" ? [fmtUsd(value), "$ saved"] : [fmtInt(value), "tokens saved"]
                      }
                    />
                    <Area
                      type="monotone"
                      dataKey="saved"
                      stroke="var(--color-primary)"
                      fill="var(--color-primary)"
                      fillOpacity={0.25}
                      strokeWidth={2}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            )}
          </Card>

          <Card className="p-4">
            <h2 className="font-medium mb-3">Recent checkpoints</h2>
            {recentRows.length === 0 ? (
              <p className="text-sm text-text-muted">No checkpoints recorded yet.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-text-muted uppercase tracking-wide border-b border-border">
                      <th className="py-2 pr-4 font-medium">Time</th>
                      <th className="py-2 pr-4 font-medium text-right">Tokens saved</th>
                      <th className="py-2 font-medium text-right">$ saved</th>
                    </tr>
                  </thead>
                  <tbody>
                    {recentRows.map((row, i) => (
                      <tr key={`${row.timestamp}-${i}`} className="border-b border-border/50 last:border-0">
                        <td className="py-2 pr-4 text-text-muted">{fmtTime(row.timestamp)}</td>
                        <td className="py-2 pr-4 text-right font-medium text-success">
                          {fmtInt(row.total_tokens_saved)}
                        </td>
                        <td className="py-2 text-right">{fmtUsd(row.compression_savings_usd)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </>
      )}
    </div>
  );
}
