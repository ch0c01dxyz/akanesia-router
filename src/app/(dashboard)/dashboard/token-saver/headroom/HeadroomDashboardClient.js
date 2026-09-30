"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import Link from "next/link";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { Card } from "@/shared/components";

const REFRESH_MS = 30000;
const RANGES = ["hourly", "daily", "weekly", "monthly"];

const fmtInt = (n) => new Intl.NumberFormat("en-US").format(Math.round(n || 0));
const fmtUsd = (n) => {
  const v = n || 0;
  return `$${v >= 1 ? v.toFixed(2) : v.toFixed(4)}`;
};
const fmtPct = (n) => `${(n || 0).toFixed(1)}%`;
const fmtMs = (n) => `${(n || 0).toFixed(n >= 100 ? 0 : 1)} ms`;

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

function fmtBucket(ts, range) {
  if (range === "hourly") {
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
  if (range === "monthly") {
    try {
      return new Date(ts).toLocaleDateString("en-US", {
        month: "short",
        year: "numeric",
      });
    } catch {
      return "";
    }
  }
  return fmtDay(ts);
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

function SectionTitle({ icon, children, right }) {
  return (
    <div className="flex items-center justify-between gap-3 flex-wrap">
      <h2 className="font-medium flex items-center gap-2">
        <span className="material-symbols-outlined text-primary text-xl">{icon}</span>
        {children}
      </h2>
      {right}
    </div>
  );
}

function KeyValue({ label, value, mono }) {
  return (
    <div className="flex items-center justify-between gap-4 py-1.5 border-b border-border/50 last:border-0 text-sm">
      <span className="text-text-muted">{label}</span>
      <span className={`font-medium text-right ${mono ? "font-mono" : ""}`}>{value}</span>
    </div>
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
  const [chartMetric, setChartMetric] = useState("tokens");
  const [modelQuery, setModelQuery] = useState("");
  const [modelSort, setModelSort] = useState({ key: "tokens_saved", dir: -1 });

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

  // ---- derived data (all defensive — fields vary by Headroom version) ----
  const lifetime = stats?.persistent_savings?.lifetime || {};
  const byModelRaw = stats?.persistent_savings?.by_model || {};
  const summary = stats?.summary || {};
  const compression = summary.compression || {};
  const cost = summary.cost || {};
  const costBreakdown = cost.breakdown || {};
  const requests = stats?.requests || {};
  const tokens = stats?.tokens || {};
  const latency = stats?.latency || {};
  const overhead = stats?.overhead || {};
  const ttfb = stats?.ttfb || {};
  const cache = stats?.cache || {};
  const prefixCache =
    stats?.persistent_savings?.prefix_cache?.totals || stats?.prefix_cache?.totals || {};
  const rateLimiter = stats?.rate_limiter || {};
  const toin = stats?.toin || {};
  const proxyInbound = stats?.proxy_inbound || {};
  const cfg = stats?.config || {};
  const litellmAvailable = stats?.litellm_available !== false;
  const savingsBasis = lifetime.savings_basis || "unknown";

  const lifetimeSavingsPct =
    lifetime.total_input_tokens > 0
      ? (lifetime.tokens_saved / lifetime.total_input_tokens) * 100
      : 0;

  const chartData = useMemo(() => {
    const series = history?.series?.[range];
    const points = Array.isArray(series) ? series : [];
    return points.map((p) => ({
      label: fmtBucket(p.timestamp, range),
      fullLabel: fmtTime(p.timestamp),
      tokens: p.tokens_saved ?? p.total_tokens_saved ?? 0,
      usd: p.compression_savings_usd_delta ?? p.compression_savings_usd ?? 0,
    }));
  }, [history, range]);

  const modelRows = useMemo(() => {
    const byModelRaw = stats?.persistent_savings?.by_model || {};
    const rows = Object.entries(byModelRaw).map(([model, m]) => ({
      model,
      requests: m.requests || 0,
      tokens_saved: m.tokens_saved || m.headline_tokens_saved || 0,
      usd: m.compression_savings_usd || 0,
      input_tokens: m.total_input_tokens || 0,
      input_cost: m.total_input_cost_usd || 0,
      savings_pct: m.savings_percent || 0,
    }));
    const q = modelQuery.trim().toLowerCase();
    const filtered = q ? rows.filter((r) => r.model.toLowerCase().includes(q)) : rows;
    const { key, dir } = modelSort;
    return [...filtered].sort((a, b) => {
      const av = a[key] ?? 0;
      const bv = b[key] ?? 0;
      if (typeof av === "string") return dir * av.localeCompare(bv);
      return dir * (av - bv);
    });
  }, [stats, modelQuery, modelSort]);

  const toggleModelSort = (key) =>
    setModelSort((s) =>
      s.key === key ? { key, dir: -s.dir } : { key, dir: key === "model" ? 1 : -1 }
    );

  const exportModelCsv = useCallback(() => {
    const header = "model,requests,tokens_saved,usd_saved,input_tokens,input_cost_usd,savings_pct";
    const lines = modelRows.map((r) =>
      [
        `"${r.model.replace(/"/g, '""')}"`,
        r.requests,
        r.tokens_saved,
        r.usd,
        r.input_tokens,
        r.input_cost,
        r.savings_pct,
      ].join(",")
    );
    const blob = new Blob([[header, ...lines].join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "headroom-by-model.csv";
    a.click();
    URL.revokeObjectURL(url);
  }, [modelRows]);

  const recentRows = useMemo(() => {
    const points = Array.isArray(history?.history) ? [...history.history] : [];
    return points.slice(-8).reverse();
  }, [history]);

  const inboundPaths = useMemo(() => {
    const byPath = stats?.proxy_inbound?.by_path || {};
    return Object.entries(byPath)
      .map(([path, count]) => ({ path, count }))
      .sort((a, b) => b.count - a.count);
  }, [stats]);

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
            {summary.mode && (
              <span className="text-text-muted">mode: <span className="font-mono">{summary.mode}</span></span>
            )}
            {cfg.savings_profile && (
              <span className="text-text-muted">profile: <span className="font-mono">{cfg.savings_profile}</span></span>
            )}
            {!litellmAvailable && (
              <span className="text-xs text-warning">LiteLLM pricing unavailable — USD figures are estimates</span>
            )}
          </div>

          <section className="space-y-3">
            <SectionTitle icon="savings">Lifetime savings</SectionTitle>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              <StatTile
                label="Requests"
                value={fmtInt(lifetime.requests)}
                sub={`basis: ${savingsBasis}`}
              />
              <StatTile
                label="Tokens saved"
                value={fmtInt(lifetime.tokens_saved)}
                sub={`${fmtPct(lifetimeSavingsPct)} of ${fmtInt(lifetime.total_input_tokens)} input tokens`}
                accent="text-success"
              />
              <StatTile
                label="$ Saved"
                value={fmtUsd(lifetime.compression_savings_usd)}
                sub={`input cost ${fmtUsd(lifetime.total_input_cost_usd)}`}
                accent="text-success"
              />
              <StatTile
                label="Cache read"
                value={fmtInt(lifetime.cache_read_tokens)}
                sub={`cache savings ${fmtUsd(lifetime.cache_savings_usd)}`}
              />
            </div>
          </section>

          <section className="space-y-3">
            <SectionTitle icon="speed">Current session</SectionTitle>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              <StatTile
                label="Requests"
                value={fmtInt(requests.total)}
                sub={`${fmtInt(requests.cached)} cached · ${fmtInt(requests.failed)} failed · ${fmtInt(requests.rate_limited)} rate-limited`}
              />
              <StatTile
                label="Tokens saved"
                value={fmtInt(tokens.saved)}
                sub={`${fmtPct(tokens.savings_percent)} savings`}
                accent="text-success"
              />
              <StatTile
                label="Tokens in / out"
                value={`${fmtInt(tokens.input)} / ${fmtInt(tokens.output)}`}
                sub={`output saved ${fmtInt(tokens.output_saved)} (${fmtPct(tokens.output_reduction_percent)})`}
              />
              <StatTile
                label="Proxy compression"
                value={fmtInt(tokens.proxy_compression_saved)}
                sub={`of ${fmtInt(tokens.total_before_compression)} before compression`}
              />
            </div>
          </section>

          <section className="space-y-3">
            <SectionTitle icon="compress">Compression detail</SectionTitle>
            <div className="grid md:grid-cols-2 gap-4">
              <Card className="p-4">
                <KeyValue label="Requests compressed" value={fmtInt(compression.requests_compressed)} mono />
                <KeyValue label="Avg compression" value={fmtPct(compression.avg_compression_pct)} mono />
                <KeyValue label="Best compression" value={fmtPct(compression.best_compression_pct)} mono />
                {compression.best_detail && (
                  <KeyValue label="Best detail" value={compression.best_detail} mono />
                )}
                <KeyValue label="Total tokens removed" value={fmtInt(compression.total_tokens_removed)} mono />
                <KeyValue label="Tokens before" value={fmtInt(compression.total_tokens_before)} mono />
                <KeyValue label="Tool schema tokens saved" value={fmtInt(compression.tool_schema_tokens_saved)} mono />
                <KeyValue label="All layers saved" value={fmtInt(compression.total_tokens_saved_all_layers)} mono />
              </Card>
              <Card className="p-4">
                <SectionTitle icon="payments">Cost breakdown</SectionTitle>
                <div className="mt-2">
                  <KeyValue label="Cost without Headroom" value={fmtUsd(cost.without_headroom_usd)} mono />
                  <KeyValue label="Cost with Headroom" value={fmtUsd(cost.with_headroom_usd)} mono />
                  <KeyValue label="Total saved" value={fmtUsd(cost.total_saved_usd)} mono />
                  <KeyValue label="Measured saved" value={fmtUsd(cost.measured_saved_usd)} mono />
                  <KeyValue label="Projected saved" value={fmtUsd(cost.projected_saved_usd)} mono />
                  <KeyValue label="Savings" value={fmtPct(cost.savings_pct)} mono />
                  <KeyValue label="Provider cache discount" value={fmtUsd(cost.provider_cache_discount_usd)} mono />
                  {Object.keys(costBreakdown).length > 0 && (
                    <div className="mt-2 pt-2 border-t border-border">
                      <p className="text-xs text-text-muted uppercase tracking-wide mb-1">Savings by source</p>
                      {Object.entries(costBreakdown).map(([k, v]) => (
                        <KeyValue key={k} label={k.replace(/_usd$/, "").replace(/_/g, " ")} value={fmtUsd(v)} mono />
                      ))}
                    </div>
                  )}
                </div>
              </Card>
            </div>
          </section>

          <section className="space-y-3">
            <SectionTitle icon="timer">Latency &amp; overhead</SectionTitle>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              <StatTile
                label="Latency (avg)"
                value={fmtMs(latency.average_ms)}
                sub={`min ${fmtMs(latency.min_ms)} · max ${fmtMs(latency.max_ms)} · n=${fmtInt(latency.total_requests)}`}
              />
              <StatTile
                label="Proxy overhead (avg)"
                value={fmtMs(overhead.average_ms)}
                sub={`min ${fmtMs(overhead.min_ms)} · max ${fmtMs(overhead.max_ms)}`}
              />
              <StatTile
                label="TTFB (avg)"
                value={fmtMs(ttfb.average_ms)}
                sub={`min ${fmtMs(ttfb.min_ms)} · max ${fmtMs(ttfb.max_ms)}`}
              />
              <StatTile
                label="Rate limiter"
                value={`${fmtInt(rateLimiter.requests_per_minute)}/min`}
                sub={`${fmtInt(rateLimiter.tokens_per_minute)} tokens/min · ${fmtInt(rateLimiter.active_keys)} active keys`}
              />
            </div>
          </section>

          <section className="space-y-3">
            <SectionTitle icon="cached">Cache &amp; proxy traffic</SectionTitle>
            <div className="grid md:grid-cols-2 gap-4">
              <Card className="p-4">
                <KeyValue label="Cache entries" value={`${fmtInt(cache.entries)} / ${fmtInt(cache.max_entries)}`} mono />
                <KeyValue label="Cache hits" value={fmtInt(cache.total_hits)} mono />
                <KeyValue label="Cache TTL" value={`${fmtInt(cache.ttl_seconds)}s`} mono />
                <KeyValue label="Prefix cache hit rate" value={fmtPct((prefixCache.hit_rate || 0) * 100)} mono />
                <KeyValue label="Prefix cache requests" value={fmtInt(prefixCache.requests)} mono />
                <KeyValue label="Prefix cache savings" value={fmtUsd(prefixCache.savings_usd)} mono />
                {toin.enabled && (
                  <>
                    <KeyValue label="TOIN patterns tracked" value={fmtInt(toin.patterns_tracked)} mono />
                    <KeyValue label="TOIN compressions" value={fmtInt(toin.total_compressions)} mono />
                    <KeyValue label="TOIN retrieval rate" value={fmtPct((toin.global_retrieval_rate || 0) * 100)} mono />
                  </>
                )}
              </Card>
              <Card className="p-4">
                <div className="flex items-center justify-between text-sm mb-1">
                  <span className="text-text-muted">Inbound requests</span>
                  <span className="font-medium font-mono">{fmtInt(proxyInbound.total)}</span>
                </div>
                <div className="flex items-center justify-between text-sm mb-2">
                  <span className="text-text-muted">Completed / active</span>
                  <span className="font-medium font-mono">{fmtInt(proxyInbound.completed)} / {fmtInt(proxyInbound.active)}</span>
                </div>
                {inboundPaths.length > 0 ? (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-left text-xs text-text-muted uppercase tracking-wide border-b border-border">
                          <th className="py-1.5 pr-4 font-medium">Path</th>
                          <th className="py-1.5 font-medium text-right">Hits</th>
                        </tr>
                      </thead>
                      <tbody>
                        {inboundPaths.map((r) => (
                          <tr key={r.path} className="border-b border-border/50 last:border-0">
                            <td className="py-1.5 pr-4 font-mono text-xs">{r.path}</td>
                            <td className="py-1.5 text-right font-medium">{fmtInt(r.count)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <p className="text-sm text-text-muted">No inbound traffic recorded.</p>
                )}
              </Card>
            </div>
          </section>

          <Card className="p-4">
            <div className="flex items-center justify-between gap-3 flex-wrap mb-3">
              <SectionTitle icon="bar_chart">Savings per period</SectionTitle>
              <div className="flex items-center gap-1 text-xs">
                {RANGES.map((r) => (
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
                <button
                  type="button"
                  onClick={() => setChartMetric(chartMetric === "tokens" ? "usd" : "tokens")}
                  className="ml-1 px-3 py-1 rounded border border-border hover:bg-surface-2"
                  title="Toggle metric"
                >
                  {chartMetric === "tokens" ? "Tokens" : "$ USD"}
                </button>
              </div>
            </div>
            {chartData.length === 0 ? (
              <p className="text-sm text-text-muted py-12 text-center">
                No compression history yet — route some requests through Headroom first.
              </p>
            ) : (
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={chartData} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" opacity={0.4} />
                    <XAxis dataKey="label" tick={{ fontSize: 11 }} stroke="var(--color-text-muted)" interval="preserveStartEnd" />
                    <YAxis
                      tick={{ fontSize: 11 }}
                      stroke="var(--color-text-muted)"
                      tickFormatter={(v) =>
                        chartMetric === "usd"
                          ? (v >= 1000 ? `$${(v / 1000).toFixed(1)}K` : `$${v.toFixed(v < 10 ? 2 : 0)}`)
                          : v >= 1000000 ? `${(v / 1000000).toFixed(1)}M` : v >= 1000 ? `${(v / 1000).toFixed(1)}K` : v
                      }
                    />
                    <Tooltip
                      contentStyle={{
                        background: "var(--color-surface)",
                        border: "1px solid var(--color-border)",
                        borderRadius: 8,
                        fontSize: 12,
                      }}
                      labelFormatter={(_, payload) => payload?.[0]?.payload?.fullLabel || ""}
                      formatter={(value) =>
                        chartMetric === "usd" ? [fmtUsd(value), "$ saved"] : [fmtInt(value), "tokens saved"]
                      }
                    />
                    <Bar
                      dataKey={chartMetric}
                      fill="var(--color-primary)"
                      fillOpacity={0.8}
                      radius={[4, 4, 0, 0]}
                      maxBarSize={48}
                    />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </Card>

          <Card className="p-4">
            <div className="flex items-center justify-between gap-3 flex-wrap mb-3">
              <SectionTitle
                icon="table_view"
                right={
                  <button
                    type="button"
                    onClick={exportModelCsv}
                    disabled={modelRows.length === 0}
                    className="px-3 py-1 rounded border border-border hover:bg-surface-2 inline-flex items-center gap-1 text-xs disabled:opacity-50"
                    title="Download per-model stats as CSV"
                  >
                    <span className="material-symbols-outlined text-sm">download</span>
                    CSV
                  </button>
                }
              >
                Savings by model ({modelRows.length})
              </SectionTitle>
              <input
                type="text"
                value={modelQuery}
                onChange={(e) => setModelQuery(e.target.value)}
                placeholder="Filter models…"
                className="rounded border border-border bg-transparent px-3 py-1.5 text-sm w-56"
              />
            </div>
            {modelRows.length === 0 ? (
              <p className="text-sm text-text-muted">No per-model data yet.</p>
            ) : (
              <div className="overflow-x-auto max-h-96 overflow-y-auto">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-surface">
                    <tr className="text-left text-xs text-text-muted uppercase tracking-wide border-b border-border">
                      {[
                        ["model", "Model"],
                        ["requests", "Requests"],
                        ["tokens_saved", "Tokens saved"],
                        ["usd", "$ saved"],
                        ["input_tokens", "Input tokens"],
                        ["savings_pct", "Savings %"],
                      ].map(([key, label]) => (
                        <th key={key} className="py-2 pr-4 font-medium">
                          <button
                            type="button"
                            onClick={() => toggleModelSort(key)}
                            className={`inline-flex items-center gap-1 hover:text-text ${modelSort.key === key ? "text-primary" : ""} ${key !== "model" ? "float-right" : ""}`}
                          >
                            {label}
                            {modelSort.key === key && (
                              <span className="material-symbols-outlined text-sm">
                                {modelSort.dir === 1 ? "arrow_upward" : "arrow_downward"}
                              </span>
                            )}
                          </button>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {modelRows.map((r) => (
                      <tr key={r.model} className="border-b border-border/50 last:border-0 hover:bg-surface-2/50">
                        <td className="py-2 pr-4 font-mono text-xs max-w-64 truncate" title={r.model}>{r.model}</td>
                        <td className="py-2 pr-4 text-right">{fmtInt(r.requests)}</td>
                        <td className="py-2 pr-4 text-right font-medium text-success">{fmtInt(r.tokens_saved)}</td>
                        <td className="py-2 pr-4 text-right">{fmtUsd(r.usd)}</td>
                        <td className="py-2 pr-4 text-right text-text-muted">{fmtInt(r.input_tokens)}</td>
                        <td className="py-2 text-right">{fmtPct(r.savings_pct)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          <Card className="p-4">
            <SectionTitle icon="history">Recent checkpoints</SectionTitle>
            {recentRows.length === 0 ? (
              <p className="text-sm text-text-muted mt-2">No checkpoints recorded yet.</p>
            ) : (
              <div className="overflow-x-auto mt-2">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-text-muted uppercase tracking-wide border-b border-border">
                      <th className="py-2 pr-4 font-medium">Time</th>
                      <th className="py-2 pr-4 font-medium">Model</th>
                      <th className="py-2 pr-4 font-medium text-right">Tokens saved</th>
                      <th className="py-2 font-medium text-right">$ saved</th>
                    </tr>
                  </thead>
                  <tbody>
                    {recentRows.map((row, i) => (
                      <tr key={`${row.timestamp}-${i}`} className="border-b border-border/50 last:border-0">
                        <td className="py-2 pr-4 text-text-muted whitespace-nowrap">{fmtTime(row.timestamp)}</td>
                        <td className="py-2 pr-4 font-mono text-xs max-w-48 truncate" title={row.model}>{row.model || "—"}</td>
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
