"use client";

import { useState, useEffect, useCallback } from "react";
import PropTypes from "prop-types";
import { Modal, Button, Badge } from "@/shared/components";
import { AI_PROVIDERS, getProviderAlias } from "@/shared/constants/providers";
import { getModelsByProviderId, getModelKind } from "@/shared/constants/models";

// Mirrors the server-side kind inference for unknown model ids
// (src/app/api/v1/models inferKindFromUnknownModelId).
const IMAGE_ID_PATTERN = /image|imagen|dall-?e|flux|sdxl|sd-|stable-diffusion/i;

function isImageModel(m) {
  const id = typeof m === "string" ? m : m?.id;
  if (!id) return false;
  const kind = typeof m === "object" ? (m.kind || m.type) : null;
  if (kind) return kind === "image";
  return IMAGE_ID_PATTERN.test(id);
}

// Two-step wizard: pick a provider that already has a connection, then
// pick which of its models are image models. The selection
// is stored as custom models (type "image") — the same store ModelsCard,
// /v1/models and the models API already read — so the provider shows up
// on the Text to Image page with exactly these models, no new backend.
export default function AddImageProviderModal({ isOpen, onClose, onSaved }) {
  const [step, setStep] = useState(1);
  const [providers, setProviders] = useState([]);
  const [connections, setConnections] = useState([]);
  const [customModels, setCustomModels] = useState([]);
  const [selectedProvider, setSelectedProvider] = useState("");
  const [candidates, setCandidates] = useState([]);
  const [checked, setChecked] = useState(new Set());
  const [manualId, setManualId] = useState("");
  const [loadingModels, setLoadingModels] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  // The parent mounts this modal only while it is open, so state starts
  // fresh every time and this effect only needs to load its data.
  useEffect(() => {
    if (!isOpen) return;
    Promise.all([
      fetch("/api/providers", { cache: "no-store" }).then((r) => r.json()).catch(() => ({})),
      fetch("/api/models/custom", { cache: "no-store" }).then((r) => r.json()).catch(() => ({})),
    ]).then(([provData, customData]) => {
      const conns = provData.connections || [];
      setConnections(conns);
      setCustomModels(customData.models || []);
      const byProvider = new Map();
      for (const c of conns) {
        if (!c.provider) continue;
        // The providers API never exposes the secret itself (allowlist
        // sanitizer in providerSanitize.js) — a connection row's existence
        // is the credential signal: apikey connections are only created
        // with a key, OAuth ones with a token.
        if (!byProvider.has(c.provider)) byProvider.set(c.provider, []);
        byProvider.get(c.provider).push(c);
      }
      const list = [...byProvider.entries()].map(([id, cs]) => ({
        id,
        name: AI_PROVIDERS[id]?.name || cs[0]?.name || id,
        count: cs.length,
        isDynamic: !AI_PROVIDERS[id],
      }));
      list.sort((a, b) => a.name.localeCompare(b.name));
      setProviders(list);
    });
  }, [isOpen]);

  const existingFor = useCallback(
    (providerId) => {
      const alias = getProviderAlias(providerId);
      return customModels.filter(
        (m) => m.providerAlias === alias && (m.kind || m.type) === "image",
      );
    },
    [customModels],
  );

  const goToModels = async () => {
    if (!selectedProvider) return;
    setStep(2);
    setLoadingModels(true);
    setError("");
    const found = new Map();
    // Registry models already classified as image.
    for (const m of getModelsByProviderId(selectedProvider)) {
      if (getModelKind(m) === "image") found.set(m.id, { id: m.id, source: "catalog" });
    }
    // Live models from the provider's own endpoint(s), via its connections.
    const conns = connections.filter((c) => c.provider === selectedProvider).slice(0, 3);
    for (const conn of conns) {
      try {
        const res = await fetch(`/api/providers/${conn.id}/models`, { cache: "no-store" });
        if (!res.ok) continue;
        const data = await res.json();
        for (const m of data.models || []) {
          const id = typeof m === "string" ? m : m?.id;
          if (id && isImageModel(m)) found.set(id, { id, source: "endpoint" });
        }
      } catch { /* endpoint unreachable — catalog + manual entry still offered */ }
    }
    // Previously saved selections always stay visible/checkable.
    const existing = existingFor(selectedProvider);
    for (const m of existing) {
      if (!found.has(m.id)) found.set(m.id, { id: m.id, source: "saved" });
    }
    setCandidates([...found.values()]);
    setChecked(new Set(existing.map((m) => m.id)));
    setLoadingModels(false);
  };

  const toggle = (id) => {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const addManual = () => {
    const id = manualId.trim();
    if (!id) return;
    if (!candidates.some((c) => c.id === id)) {
      setCandidates((prev) => [...prev, { id, source: "manual" }]);
    }
    setChecked((prev) => new Set(prev).add(id));
    setManualId("");
  };

  const handleSave = async () => {
    setSaving(true);
    setError("");
    try {
      const alias = getProviderAlias(selectedProvider);
      const existing = existingFor(selectedProvider);
      const existingIds = new Set(existing.map((m) => m.id));
      for (const id of checked) {
        if (existingIds.has(id)) continue;
        const res = await fetch("/api/models/custom", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ providerAlias: alias, id, type: "image" }),
        });
        if (!res.ok) throw new Error(`Failed to save model ${id}`);
      }
      for (const m of existing) {
        if (checked.has(m.id)) continue;
        const params = new URLSearchParams({ providerAlias: alias, id: m.id, type: "image" });
        await fetch(`/api/models/custom?${params}`, { method: "DELETE" });
      }
      onSaved?.();
      onClose();
    } catch (e) {
      setError(e.message || "Failed to save");
    } finally {
      setSaving(false);
    }
  };

  const footer = step === 1 ? (
    <>
      <Button variant="secondary" onClick={onClose}>Cancel</Button>
      <Button onClick={goToModels} disabled={!selectedProvider}>Next</Button>
    </>
  ) : (
    <>
      <Button variant="secondary" onClick={() => setStep(1)}>Back</Button>
      <Button onClick={handleSave} disabled={saving || checked.size === 0}>
        {saving ? "Saving..." : "Add to Text to Image"}
      </Button>
    </>
  );

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Add provider/model from Endpoint"
      size="lg"
      footer={footer}
    >
      {error && <p className="text-sm text-red-500 mb-3 break-words">{error}</p>}
      {step === 1 && (
        <div className="flex flex-col gap-2">
          <p className="text-sm text-text-muted mb-1">
            Choose a provider that already has a connection.
          </p>
          {providers.length === 0 && (
            <p className="text-sm text-text-muted py-6 text-center">
              No providers with a connection yet.
            </p>
          )}
          {providers.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => setSelectedProvider(p.id)}
              className={`flex items-center justify-between gap-3 rounded-lg border px-3 py-2 text-left transition-colors ${
                selectedProvider === p.id
                  ? "border-primary bg-primary/5"
                  : "border-border hover:bg-black/[0.02] dark:hover:bg-white/[0.02]"
              }`}
            >
              <span className="min-w-0">
                <span className="block truncate text-sm font-medium">{p.name}</span>
                <span className="block truncate text-xs text-text-muted">{p.id}</span>
              </span>
              <span className="flex shrink-0 items-center gap-2">
                {p.isDynamic && <Badge variant="default" size="sm">Custom</Badge>}
                <Badge variant="success" size="sm" dot>{p.count} Connected</Badge>
              </span>
            </button>
          ))}
        </div>
      )}
      {step === 2 && (
        <div className="flex flex-col gap-2">
          <p className="text-sm text-text-muted mb-1">
            Select the models that support image generation. Only these will be
            listed for this provider on the Text to Image page.
          </p>
          {loadingModels && (
            <p className="text-sm text-text-muted py-6 text-center">Loading models from endpoint...</p>
          )}
          {!loadingModels && candidates.length === 0 && (
            <p className="text-sm text-text-muted py-4 text-center">
              No image models detected from the catalog or the endpoint. Add one manually below.
            </p>
          )}
          {!loadingModels && candidates.map((c) => (
            <label
              key={c.id}
              className="flex cursor-pointer items-center justify-between gap-3 rounded-lg border border-border px-3 py-2 hover:bg-black/[0.02] dark:hover:bg-white/[0.02]"
            >
              <span className="flex min-w-0 items-center gap-2">
                <input
                  type="checkbox"
                  checked={checked.has(c.id)}
                  onChange={() => toggle(c.id)}
                  className="size-4 shrink-0 accent-primary"
                />
                <code className="truncate text-sm">{c.id}</code>
              </span>
              <Badge variant="default" size="sm">{c.source}</Badge>
            </label>
          ))}
          <div className="mt-2 flex gap-2">
            <input
              type="text"
              value={manualId}
              onChange={(e) => setManualId(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addManual(); } }}
              placeholder="Add model id manually, e.g. gpt-image-2"
              className="min-w-0 flex-1 rounded-lg border border-border bg-transparent px-3 py-2 text-sm outline-none focus:border-primary"
            />
            <Button variant="secondary" onClick={addManual} disabled={!manualId.trim()}>Add</Button>
          </div>
        </div>
      )}
    </Modal>
  );
}

AddImageProviderModal.propTypes = {
  isOpen: PropTypes.bool.isRequired,
  onClose: PropTypes.func.isRequired,
  onSaved: PropTypes.func,
};
