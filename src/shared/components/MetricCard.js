"use client";

import PropTypes from "prop-types";
import { cn } from "@/shared/utils/cn";

const TONE_CLASSES = {
  neutral: "text-text-main",
  good: "text-green-600 dark:text-green-400",
  bad: "text-red-500 dark:text-red-400",
};

/**
 * Kartu angka kecil untuk metrik hasil probe (TTFT, TPS, latensi, token).
 */
export default function MetricCard({ label, value, sub, tone = "neutral", className }) {
  return (
    <div
      className={cn(
        "rounded-[10px] border border-border-subtle bg-surface p-3",
        className
      )}
    >
      <p className="text-xs text-text-muted">{label}</p>
      <p className={cn("mt-0.5 text-xl font-semibold", TONE_CLASSES[tone] || TONE_CLASSES.neutral)}>
        {value}
      </p>
      {sub && <p className="mt-0.5 text-xs text-text-muted">{sub}</p>}
    </div>
  );
}

MetricCard.propTypes = {
  label: PropTypes.string.isRequired,
  value: PropTypes.node.isRequired,
  sub: PropTypes.node,
  tone: PropTypes.oneOf(["neutral", "good", "bad"]),
  className: PropTypes.string,
};
