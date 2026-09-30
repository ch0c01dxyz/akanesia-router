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
        const severity = SEVERITY_LABEL[warning?.severity] ? warning.severity : "info";
        const expanded = openIndex === index;
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
              <span className="min-w-0 flex-1 truncate text-sm text-text-main">
                {warning?.label || translate("Unlabeled")}
              </span>
              <span className="material-symbols-outlined text-text-muted text-[20px]">
                {expanded ? "expand_less" : "expand_more"}
              </span>
            </button>
            {expanded && warning?.detail && (
              <p className="border-t border-border-subtle px-3 py-2.5 text-sm text-text-main whitespace-pre-wrap break-words">
                {warning.detail}
              </p>
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
      severity: PropTypes.oneOf(["info", "warn", "critical"]),
      label: PropTypes.string,
      detail: PropTypes.string,
    })
  ),
  className: PropTypes.string,
};
