"use client";

import { useEffect, useState } from "react";
import PropTypes from "prop-types";
import { Button } from "@/shared/components";
import { getProviderCustomModelRows } from "@/shared/utils/providerCustomModels";

// Model dianggap Free bila id-nya mengandung "-free" atau ":free".
const isFreeById = (id) => /-free|:free/.test(id || "");

function CompatibleModelRow({ modelId, fullModel, copied, onCopy, onDeleteAlias, onTest, testStatus, isTesting, isFree, onToggleFree }) {
  const borderColor = testStatus === "ok"
    ? "border-green-500/40"
    : testStatus === "error"
    ? "border-red-500/40"
    : "border-border";

  const iconColor = testStatus === "ok"
    ? "#22c55e"
    : testStatus === "error"
    ? "#ef4444"
    : undefined;

  return (
    <div className={`flex items-center gap-3 p-3 rounded-lg border ${borderColor} hover:bg-sidebar/50`}>
      <span
        className="material-symbols-outlined text-base text-text-muted"
        style={iconColor ? { color: iconColor } : undefined}
      >
        {testStatus === "ok" ? "check_circle" : testStatus === "error" ? "cancel" : "smart_toy"}
      </span>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium truncate">{modelId}</p>
        <div className="flex items-center gap-1 mt-1">
          <code className="text-xs text-text-muted font-mono bg-sidebar px-1.5 py-0.5 rounded">{fullModel}</code>
          <div className="relative group/btn">
            <button
              onClick={() => onCopy(fullModel, `model-${modelId}`)}
              className="p-0.5 hover:bg-sidebar rounded text-text-muted hover:text-primary"
            >
              <span className="material-symbols-outlined text-sm">
                {copied === `model-${modelId}` ? "check" : "content_copy"}
              </span>
            </button>
            <span className="pointer-events-none absolute top-5 left-1/2 -translate-x-1/2 text-[10px] text-text-muted whitespace-nowrap opacity-0 group-hover/btn:opacity-100 transition-opacity">
              {copied === `model-${modelId}` ? "Copied!" : "Copy"}
            </span>
          </div>
          <div className="relative group/btn">
            <button
              onClick={() => onToggleFree(modelId)}
              className="p-0.5 hover:bg-sidebar rounded text-text-muted hover:text-primary"
              style={isFree ? { color: "#22c55e" } : undefined}
              title={isFree ? "Move to Premium" : "Move to Free"}
            >
              <span className="material-symbols-outlined text-sm">sell</span>
            </button>
            <span className="pointer-events-none absolute top-5 left-1/2 -translate-x-1/2 text-[10px] text-text-muted whitespace-nowrap opacity-0 group-hover/btn:opacity-100 transition-opacity">
              {isFree ? "Move to Premium" : "Move to Free"}
            </span>
          </div>
          {onTest && (
            <div className="relative group/btn">
              <button
                onClick={onTest}
                disabled={isTesting}
                className="p-0.5 hover:bg-sidebar rounded text-text-muted hover:text-primary transition-colors"
              >
                <span className="material-symbols-outlined text-sm" style={isTesting ? { animation: "spin 1s linear infinite" } : undefined}>
                  {isTesting ? "progress_activity" : "science"}
                </span>
              </button>
              <span className="pointer-events-none absolute top-5 left-1/2 -translate-x-1/2 text-[10px] text-text-muted whitespace-nowrap opacity-0 group-hover/btn:opacity-100 transition-opacity">
                {isTesting ? "Testing..." : "Test"}
              </span>
            </div>
          )}
        </div>
      </div>
      <button
        onClick={onDeleteAlias}
        className="p-1 hover:bg-red-50 rounded text-red-500"
        title="Remove model"
      >
        <span className="material-symbols-outlined text-sm">delete</span>
      </button>
    </div>
  );
}

const MODEL_TABS = [
  { id: "all", label: "All" },
  { id: "premium", label: "Premium" },
  { id: "free", label: "Free" },
];

export default function CompatibleModelsSection({ providerId, providerStorageAlias, providerDisplayAlias, modelAliases, customModels, copied, onCopy, onDeleteAlias, onAddCustomModel, onDeleteCustomModel, connections, isAnthropic }) {
  const [newModel, setNewModel] = useState("");
  const [adding, setAdding] = useState(false);
  const [importing, setImporting] = useState(false);
  const [testingModelId, setTestingModelId] = useState(null);
  const [modelTestResults, setModelTestResults] = useState({});
  const [checkingModels, setCheckingModels] = useState(false);
  const [checkResult, setCheckResult] = useState(null);
  const [activeTab, setActiveTab] = useState("all");

  // Override kategori Free/Premium per model (manual via ikon tag).
  // Hanya untuk penataan tampilan — tidak mengubah id/nama asli model.
  const freeOverrideKey = `akanesia:model-free-overrides:${providerStorageAlias}`;
  const [freeOverrides, setFreeOverrides] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem(freeOverrideKey) || "{}");
    } catch {
      return {};
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(freeOverrideKey, JSON.stringify(freeOverrides));
    } catch {
      // abaikan (storage penuh / mode privat)
    }
  }, [freeOverrideKey, freeOverrides]);

  const isEffectiveFree = (id) =>
    freeOverrides[id] !== undefined ? freeOverrides[id] : isFreeById(id);

  const handleToggleFree = (id) => {
    setFreeOverrides((prev) => {
      const effective = prev[id] !== undefined ? prev[id] : isFreeById(id);
      return { ...prev, [id]: !effective };
    });
  };

  const handleTestModel = async (modelId) => {
    if (testingModelId) return;
    setTestingModelId(modelId);
    try {
      const res = await fetch("/api/models/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: `${providerStorageAlias}/${modelId}` }),
      });
      const data = await res.json();
      setModelTestResults((prev) => ({ ...prev, [modelId]: data.ok ? "ok" : "error" }));
    } catch {
      setModelTestResults((prev) => ({ ...prev, [modelId]: "error" }));
    } finally {
      setTestingModelId(null);
    }
  };

  const allModels = getProviderCustomModelRows({
    customModels,
    modelAliases,
    providerAlias: providerStorageAlias,
    type: "llm",
  });

  const handleAdd = async () => {
    if (!newModel.trim() || adding) return;
    const modelId = newModel.trim();
    if (allModels.some((model) => model.id === modelId)) {
      alert("Model already exists for this provider.");
      return;
    }

    setAdding(true);
    try {
      await onAddCustomModel(modelId);
      setNewModel("");
    } catch (error) {
      console.log("Error adding model:", error);
    } finally {
      setAdding(false);
    }
  };

  const handleImport = async () => {
    if (importing) return;
    const activeConnection = connections.find((conn) => conn.isActive !== false);
    if (!activeConnection) return;

    setImporting(true);
    try {
      const res = await fetch(`/api/providers/${activeConnection.id}/models`);
      const data = await res.json();
      if (!res.ok) {
        alert(data.error || "Failed to import models");
        return;
      }
      const models = data.models || [];
      if (models.length === 0) {
        alert("No models returned from /models.");
        return;
      }
      let importedCount = 0;
      for (const model of models) {
        const modelId = model.id || model.name || model.model;
        if (!modelId) continue;
        if (allModels.some((entry) => entry.id === modelId)) continue;
        await onAddCustomModel(modelId);
        importedCount += 1;
      }
      if (importedCount === 0) {
        alert("No new models were added.");
      }
    } catch (error) {
      console.log("Error importing models:", error);
    } finally {
      setImporting(false);
    }
  };

  const handleCheckModels = async () => {
    if (checkingModels) return;
    setCheckingModels(true);
    setCheckResult(null);
    try {
      const res = await fetch("/api/providers/check-models", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "provider", providerId: providerId || providerStorageAlias, forceRefresh: true }),
      });
      const data = await res.json();
      setCheckResult(data);
    } catch (error) {
      setCheckResult({ error: error?.message || "Model check request failed" });
    } finally {
      setCheckingModels(false);
    }
  };

  const canImport = connections.some((conn) => conn.isActive !== false);

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-text-muted">
        Add {isAnthropic ? "Anthropic" : "OpenAI"}-compatible models manually or import them from the /models endpoint.
      </p>

      <div className="flex items-end gap-2 flex-wrap">
        <div className="flex-1 min-w-[240px]">
          <label htmlFor="new-compatible-model-input" className="text-xs text-text-muted mb-1 block">Model ID</label>
          <input
            id="new-compatible-model-input"
            type="text"
            value={newModel}
            onChange={(e) => setNewModel(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleAdd()}
            placeholder={isAnthropic ? "claude-3-opus-20240229" : "gpt-4o"}
            className="w-full px-3 py-2 text-sm border border-border rounded-lg bg-background focus:outline-none focus:border-primary"
          />
        </div>
        <Button size="sm" icon="add" onClick={handleAdd} disabled={!newModel.trim() || adding}>
          {adding ? "Adding..." : "Add"}
        </Button>
        <Button size="sm" variant="secondary" icon="download" onClick={handleImport} disabled={!canImport || importing}>
          {importing ? "Importing..." : "Import from /models"}
        </Button>
        <Button size="sm" variant="secondary" icon="fact_check" onClick={handleCheckModels} disabled={checkingModels} title="Check available models for this provider">
          {checkingModels ? "Checking..." : "Check Models"}
        </Button>
      </div>

      {/* Tab kategori model: All / Premium / Free */}
      <div className="grid grid-cols-4 gap-2">
        {MODEL_TABS.map((tab) => {
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`px-3 py-2 text-sm rounded-lg border transition-colors ${
                isActive
                  ? "bg-primary text-white border-primary font-medium"
                  : "border-border text-text-muted hover:text-text-main hover:border-primary/50 bg-background"
              }`}
            >
              {tab.label}
            </button>
          );
        })}
      </div>

      {checkResult && (() => {
        const item = (checkResult.results || [])[0];
        return (
          <div className="rounded-lg border border-border bg-black/[0.02] dark:bg-white/[0.02] p-3 text-xs">
            <div className="flex items-center justify-between mb-2">
              <span className="font-medium text-sm">Model check result</span>
              <button onClick={() => setCheckResult(null)} className="text-text-muted hover:text-text-main" aria-label="Close">
                <span className="material-symbols-outlined text-base">close</span>
              </button>
            </div>
            {checkResult.error && !item ? (
              <p className="text-red-400">{checkResult.error}</p>
            ) : item ? (
              <div className="flex flex-col gap-1.5">
                <div className="flex items-center gap-2">
                  <span className={`material-symbols-outlined text-[16px] ${item.ok ? "text-emerald-500" : item.skipped ? "text-amber-500" : "text-red-500"}`}>
                    {item.ok ? "check_circle" : item.skipped ? "pause_circle" : "error"}
                  </span>
                  <span className="font-medium">{item.name || item.provider}</span>
                  {item.latencyMs !== undefined && <span className="text-text-muted font-mono">{item.latencyMs}ms</span>}
                  <span className={`text-[10px] uppercase font-bold px-1.5 py-0.5 rounded ${item.ok ? "bg-emerald-500/15 text-emerald-400" : item.skipped ? "bg-amber-500/15 text-amber-400" : "bg-red-500/15 text-red-400"}`}>
                    {item.ok ? `${item.modelCount ?? 0} models` : item.skipped ? "skipped" : "error"}
                  </span>
                </div>
                {!item.ok && !item.skipped && item.error && <p className="text-red-400 break-words">{item.error}</p>}
                {item.skipped && item.reason && <p className="text-amber-400/80">{item.reason}</p>}
                {item.ok && item.models && item.models.length > 0 && (
                  <div className="max-h-48 overflow-y-auto mt-1">
                    {item.models.map((m) => (
                      <code key={m} className="block truncate py-0.5 font-mono text-text-muted">{m}</code>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              <p className="text-text-muted">No result returned.</p>
            )}
          </div>
        );
      })()}

      {!canImport && (
        <p className="text-xs text-text-muted">
          Add a connection to enable importing models.
        </p>
      )}

      {allModels.length > 0 && (
        <div className="flex flex-col gap-3">
          {allModels
            .filter(({ id }) => {
              if (activeTab === "all") return true;
              const free = isEffectiveFree(id);
              return activeTab === "free" ? free : !free;
            })
            .map(({ id, alias, source }) => (
            <CompatibleModelRow
              key={`${source}-${providerStorageAlias}/${id}`}
              modelId={id}
              fullModel={`${providerDisplayAlias}/${id}`}
              copied={copied}
              onCopy={onCopy}
              onDeleteAlias={() => source === "custom" ? onDeleteCustomModel(id) : onDeleteAlias(alias)}
              onTest={connections.length > 0 ? () => handleTestModel(id) : undefined}
              testStatus={modelTestResults[id]}
              isTesting={testingModelId === id}
              isFree={isEffectiveFree(id)}
              onToggleFree={handleToggleFree}
            />
          ))}
        </div>
      )}
    </div>
  );
}

CompatibleModelsSection.propTypes = {
  providerId: PropTypes.string,
  providerStorageAlias: PropTypes.string.isRequired,
  providerDisplayAlias: PropTypes.string.isRequired,
  modelAliases: PropTypes.object.isRequired,
  customModels: PropTypes.arrayOf(PropTypes.object),
  copied: PropTypes.string,
  onCopy: PropTypes.func.isRequired,
  onDeleteAlias: PropTypes.func.isRequired,
  onAddCustomModel: PropTypes.func.isRequired,
  onDeleteCustomModel: PropTypes.func.isRequired,
  connections: PropTypes.arrayOf(PropTypes.shape({
    id: PropTypes.string,
    isActive: PropTypes.bool,
  })).isRequired,
  isAnthropic: PropTypes.bool,
};
