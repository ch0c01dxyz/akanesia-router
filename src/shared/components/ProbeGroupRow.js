"use client";

import PropTypes from "prop-types";
import { cn } from "@/shared/utils/cn";
import { translate } from "@/i18n/runtime";

// Warna strip status 10px per status grup probe.
const STATUS_DOT = {
  pass: "bg-green-500",
  warn: "bg-yellow-500",
  fail: "bg-red-500",
  skip: "bg-text-muted/40",
};

const STATUS_LABEL = {
  pass: "Passed",
  warn: "Warnings",
  fail: "Failed",
  skip: "Dilewati",
};

/**
 * Satu baris grup probe hasil: strip status + label + hitungan "X/Y lolos"
 * (bila data tersedia) + expand/collapse untuk evidence inline (children).
 */
export default function ProbeGroupRow({ group, expanded, onToggle, children }) {
  const { id, label, status, detail } = group || {};
  const statusKey = STATUS_LABEL[status] ? status : "skip";

  // Hitungan "X/Y lolos": dari array items bila ada, atau field passed/total.
  let passedCount = null;
  let totalCount = null;
  if (Array.isArray(group?.items)) {
    totalCount = group.items.length;
    passedCount = group.items.filter((it) => it?.status === "pass").length;
  } else if (typeof group?.passed === "number" && typeof group?.total === "number") {
    passedCount = group.passed;
    totalCount = group.total;
  }

  return (
    <div className="rounded-[10px] border border-border-subtle bg-surface">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={!!expanded}
        aria-controls={id ? `probe-group-${id}` : undefined}
        className="flex w-full items-center gap-3 px-3 py-2.5 text-left hover:bg-surface-2/50 transition-colors rounded-[10px]"
      >
        {/* Strip status: kotak 10px */}
        <span
          aria-hidden="true"
          title={STATUS_LABEL[statusKey]}
          className={cn("h-2.5 w-2.5 shrink-0 rounded-[2px]", STATUS_DOT[statusKey])}
        />
        <span className="min-w-0 flex-1 truncate text-sm font-medium text-text-main">
          {label || id}
        </span>
        {passedCount !== null && totalCount !== null && (
          <span className="shrink-0 text-xs text-text-muted">
            {translate("{passed}/{total} passed")
              .replace("{passed}", String(passedCount))
              .replace("{total}", String(totalCount))}
          </span>
        )}
        <span className="material-symbols-outlined text-text-muted text-[20px] transition-transform">
          {expanded ? "expand_less" : "expand_more"}
        </span>
      </button>
      {expanded && (
        <div id={id ? `probe-group-${id}` : undefined} className="border-t border-border-subtle px-3 py-2.5">
          {detail && <p className="text-sm text-text-main whitespace-pre-wrap break-words">{detail}</p>}
          {children}
        </div>
      )}
    </div>
  );
}

ProbeGroupRow.propTypes = {
  group: PropTypes.shape({
    id: PropTypes.string,
    label: PropTypes.string,
    status: PropTypes.oneOf(["pass", "warn", "fail", "skip"]),
    detail: PropTypes.string,
    items: PropTypes.array,
    passed: PropTypes.number,
    total: PropTypes.number,
  }).isRequired,
  expanded: PropTypes.bool,
  onToggle: PropTypes.func,
  children: PropTypes.node,
};
