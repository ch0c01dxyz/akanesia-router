"use client";

import { useState } from "react";
import PropTypes from "prop-types";
import { cn } from "@/shared/utils/cn";
import { translate } from "@/i18n/runtime";

// Warna pill severity peringatan probe.
const SEVERITY_PILL = {
  info: "bg-surface-3 text-text-muted border-border",
  warn: "bg-yellow-500/15 text-yellow-600 dark:text-yellow-400 border-yellow-500/30",
  critical: "bg-red-500/15 text-red-500 border-red-500/30",
};

const SEVERITY_LABEL = {
  info: "Info",
  warn: "Warnings",
  critical: "Kritis",
};

// Label ramah untuk key peringatan BazaarLink ("probe.warning.xxx").
// Key yang belum dikenal dirapikan generik: underscore -> spasi, kapital.
const WARNING_LABEL_EN = {
  unofficial_package_source: "Unofficial package source",
};

function prettifyWarningKey(label) {
  if (typeof label !== "string") return "";
  const m = label.match(/^probe\.warning\.([a-z0-9_]+)$/i);
  const key = m ? m[1] : null;
  if (key && WARNING_LABEL_EN[key]) return WARNING_LABEL_EN[key];
  if (key) {
    const words = key.replace(/_/g, " ").trim();
    return words.charAt(0).toUpperCase() + words.slice(1);
  }
  return label;
}

// Normalisasi severity: kontrak online memakai "warning", offline memakai
// "warn" — keduanya dipetakan ke pill yang sama.
function normalizeSeverity(severity) {
  const s = severity === "warning" ? "warn" : severity;
  return SEVERITY_LABEL[s] ? s : "info";
}

/**
 * Daftar peringatan hasil probe: pill severity + label; klik baris untuk
 * expand detail inline.
 */
export default function WarningList({ warnings = [], className }) {
  const [openIndex, setOpenIndex] = useState(null);

  if (!warnings || warnings.length === 0) return null;

  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <h4 className="text-sm font-medium text-text-main">{translate("Warnings")}</h4>
      {warnings.map((warning, index) => {
        const severity = normalizeSeverity(warning?.severity);
        const expanded = openIndex === index;
        // Bentuk offline: { label, detail }. Bentuk online (BazaarLink):
        // { id, label: "probe.warning.xxx", severity: "warning", evidence: [] }.
        const labelText = prettifyWarningKey(warning?.label) || translate("Unlabeled");
        const detailText = typeof warning?.detail === "string" ? warning.detail : "";
        const evidenceList = Array.isArray(warning?.evidence)
          ? warning.evidence.filter((e) => e != null && String(e).trim() !== "")
          : [];
        const hasContent = detailText.trim() !== "" || evidenceList.length > 0;
        return (
          <div key={index} className="rounded-[10px] border border-border-subtle bg-surface">
            <button
              type="button"
              onClick={() => setOpenIndex(expanded ? null : index)}
              aria-expanded={expanded}
              className="flex w-full items-center gap-2.5 px-3 py-2 text-left hover:bg-surface-2/50 transition-colors rounded-[10px]"
            >
              <span
                className={cn(
                  "shrink-0 rounded-full border px-2 py-0.5 text-xs font-medium",
                  SEVERITY_PILL[severity]
                )}
              >
                {SEVERITY_LABEL[severity]}
              </span>
              <span className="min-w-0 flex-1 truncate text-sm text-text-main" title={labelText}>
                {labelText}
              </span>
              <span className="material-symbols-outlined text-text-muted text-[20px]">
                {expanded ? "expand_less" : "expand_more"}
              </span>
            </button>
            {expanded && (
              <div className="border-t border-border-subtle px-3 py-2.5">
                {detailText.trim() !== "" && (
                  <p className="whitespace-pre-wrap break-words text-sm text-text-main">{detailText}</p>
                )}
                {evidenceList.length > 0 && (
                  <ul className="flex list-disc flex-col gap-1.5 pl-5">
                    {evidenceList.map((ev, i) => (
                      <li key={i} className="whitespace-pre-wrap break-words text-sm text-text-main">
                        {String(ev)}
                      </li>
                    ))}
                  </ul>
                )}
                {!hasContent && (
                  <p className="text-sm text-text-muted">{translate("No details available.")}</p>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

WarningList.propTypes = {
  warnings: PropTypes.arrayOf(
    PropTypes.shape({
      // Offline: "info" | "warn" | "critical". Online (BazaarLink): "warning" (dipetakan ke "warn").
      severity: PropTypes.string,
      // Offline: label tampilan. Online: key "probe.warning.xxx" (dirapikan otomatis).
      label: PropTypes.string,
      // Offline: detail string. Online: evidence[] (array string).
      detail: PropTypes.string,
      evidence: PropTypes.array,
    })
  ),
  className: PropTypes.string,
};
