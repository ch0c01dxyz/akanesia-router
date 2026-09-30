"use client";

import { useState } from "react";
import PropTypes from "prop-types";
import { Button, Input, Select } from "@/shared/components";
import { HEADER_NAME_RE, CUSTOM_HEADERS_MAX } from "@/shared/utils/customHeaders.js";

// Ide #8 — Editor key-value custom headers untuk "Advanced Option" di modal
// tambah/edit provider custom. Collapsed by default.
const PRESET_OPTIONS = [
  { value: "", label: "Pilih preset…" },
  { value: "Authorization", label: "Authorization: Bearer {{key}}" },
  { value: "x-api-key", label: "x-api-key: {{key}}" },
  { value: "X-API-Key", label: "X-API-Key: {{key}}" },
  { value: "xi-api-key", label: "xi-api-key: {{key}}" },
];

export default function CustomHeadersEditor({ value = [], onChange }) {
  const [open, setOpen] = useState(false);
  const [preset, setPreset] = useState("");
  const [error, setError] = useState("");

  const headers = Array.isArray(value) ? value : [];

  const update = (next) => {
    setError("");
    onChange(next);
  };

  const handleAddPreset = (name) => {
    setPreset("");
    if (!name) return;
    if (headers.some((h) => h.name.toLowerCase() === name.toLowerCase())) {
      setError(`Header "${name}" sudah ada`);
      return;
    }
    update([...headers, { name, value: "{{key}}" }]);
  };

  const handleAddRow = () => {
    if (headers.length >= CUSTOM_HEADERS_MAX) {
      setError(`Maksimal ${CUSTOM_HEADERS_MAX} custom header`);
      return;
    }
    update([...headers, { name: "", value: "" }]);
  };

  const handleRowChange = (idx, field, val) => {
    const next = headers.map((h, i) => (i === idx ? { ...h, [field]: val } : h));
    const name = field === "name" ? val.trim() : next[idx].name.trim();
    if (name && !HEADER_NAME_RE.test(name)) {
      setError(`Nama header tidak valid: "${name}"`);
    } else if (error) {
      setError("");
    }
    onChange(next);
  };

  const handleRemove = (idx) => {
    setError("");
    update(headers.filter((_, i) => i !== idx));
  };

  return (
    <div className="rounded-lg border border-border bg-surface/50">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between px-4 py-3 text-left"
      >
        <span className="text-sm font-medium text-text-main">
          Advanced Option
          {headers.length > 0 && (
            <span className="ml-2 rounded-full bg-primary/10 px-2 py-0.5 text-xs text-primary">
              {headers.length} header
            </span>
          )}
        </span>
        <span className="text-text-muted">{open ? "▾" : "▸"}</span>
      </button>

      {open && (
        <div className="flex flex-col gap-3 border-t border-border px-4 py-3">
          <p className="text-xs text-text-muted">
            Header tambahan yang dikirim ke provider ini.{" "}
            <code className="rounded bg-surface px-1">{"{{key}}"}</code> otomatis
            diganti API key koneksi. Custom header menang atas header default
            jika nama sama. Value tidak dimunculkan di log.
          </p>

          {headers.map((h, idx) => (
            <div key={idx} className="flex items-start gap-2">
              <Input
                label={idx === 0 ? "Name" : undefined}
                value={h.name}
                onChange={(e) => handleRowChange(idx, "name", e.target.value)}
                placeholder="x-api-key"
                className="flex-1"
              />
              <Input
                label={idx === 0 ? "Value" : undefined}
                value={h.value}
                onChange={(e) => handleRowChange(idx, "value", e.target.value)}
                placeholder="{{key}}"
                className="flex-1"
              />
              <div className={idx === 0 ? "pt-6" : ""}>
                <Button
                  variant="ghost"
                  onClick={() => handleRemove(idx)}
                  title="Hapus header"
                >
                  ✕
                </Button>
              </div>
            </div>
          ))}

          {error && <span className="text-sm text-red-500">{error}</span>}

          <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
            <Select
              label="Preset"
              options={PRESET_OPTIONS}
              value={preset}
              onChange={(e) => handleAddPreset(e.target.value)}
              className="flex-1"
            />
            <Button variant="secondary" onClick={handleAddRow} className="w-full sm:w-auto">
              ＋ Add header
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

CustomHeadersEditor.propTypes = {
  value: PropTypes.arrayOf(
    PropTypes.shape({
      name: PropTypes.string,
      value: PropTypes.string,
    })
  ),
  onChange: PropTypes.func.isRequired,
};
