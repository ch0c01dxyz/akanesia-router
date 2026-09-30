"use client";

import { useState, useRef, useEffect, useMemo } from "react";
import PropTypes from "prop-types";
import { cn } from "@/shared/utils/cn";
import { translate } from "@/i18n/runtime";

/**
 * Selectbox searchable (pengganti Select.js yang native tanpa search).
 *
 * Render sebagai button yang membuka panel dropdown berisi input search di
 * atas + daftar opsi yang terfilter (substring case-insensitive pada label).
 * Filter sederhana ini cukup lancar untuk >=200 opsi tanpa virtualisasi.
 */
export default function SearchableSelect({
  label,
  options = [],
  value,
  onChange,
  placeholder = "Pilih opsi",
  disabled = false,
  required = false,
  hint,
  className,
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const rootRef = useRef(null);
  const searchRef = useRef(null);

  const selected = options.find((o) => o.value === value) || null;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter((o) => String(o.label).toLowerCase().includes(q));
  }, [options, query]);

  // Klik di luar panel menutup dropdown.
  useEffect(() => {
    if (!open) return;
    const onDocClick = (e) => {
      if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [open]);

  // Saat dibuka: fokuskan input search (sinkronisasi ke DOM, bukan setState).
  useEffect(() => {
    if (!open) return;
    const frame = requestAnimationFrame(() => searchRef.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [open]);

  const toggleOpen = () => {
    if (!open) setQuery(""); // reset query setiap dropdown dibuka
    setOpen((v) => !v);
  };

  const pick = (optionValue) => {
    onChange?.(optionValue);
    setOpen(false);
  };

  return (
    <div className={cn("flex flex-col gap-1.5", className)} ref={rootRef}>
      {label && (
        <label className="text-sm font-medium text-text-main">
          {label}
          {required && <span className="text-red-500 ml-1">*</span>}
        </label>
      )}
      <div className="relative">
        <button
          type="button"
          disabled={disabled}
          onClick={toggleOpen}
          onKeyDown={(e) => {
            if (e.key === "Escape") setOpen(false);
          }}
          aria-haspopup="listbox"
          aria-expanded={open}
          className={cn(
            "w-full py-2.5 px-3 pr-10 text-sm text-text-main text-left",
            "bg-surface-2 border border-transparent rounded-[10px]",
            "focus:outline-none focus:ring-2 focus:ring-brand-500/30 focus:border-brand-500/40",
            "transition-all duration-150 disabled:opacity-50 disabled:cursor-not-allowed",
            "text-[16px] sm:text-sm"
          )}
        >
          <span className={cn("block truncate", !selected && "text-text-muted")}>
            {selected ? selected.label : placeholder}
          </span>
        </button>
        <div className="absolute inset-y-0 right-0 flex items-center pr-3 pointer-events-none text-text-muted">
          <span className="material-symbols-outlined text-[20px]">expand_more</span>
        </div>

        {open && !disabled && (
          <div className="absolute z-20 mt-1 w-full overflow-hidden rounded-[10px] border border-border bg-surface shadow-[var(--shadow-elev)]">
            <div className="border-b border-border-subtle p-2">
              <input
                ref={searchRef}
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Escape") setOpen(false);
                }}
                placeholder={translate("Search...")}
                aria-label={translate("Search options")}
                className="w-full rounded-lg border border-border bg-background px-3 py-1.5 text-sm text-text-main focus:border-primary focus:outline-none"
              />
            </div>
            <ul role="listbox" className="max-h-60 overflow-y-auto py-1">
              {filtered.length === 0 ? (
                <li className="px-3 py-2 text-sm text-text-muted">
                  {translate("No results")}
                </li>
              ) : (
                filtered.map((option) => (
                  <li key={option.value} role="option" aria-selected={option.value === value}>
                    <button
                      type="button"
                      onClick={() => pick(option.value)}
                      className={cn(
                        "block w-full truncate px-3 py-1.5 text-left text-sm",
                        option.value === value
                          ? "bg-primary/15 text-text-main font-medium"
                          : "text-text-main hover:bg-surface-2"
                      )}
                      title={option.label}
                    >
                      {option.label}
                    </button>
                  </li>
                ))
              )}
            </ul>
          </div>
        )}
      </div>
      {hint && <p className="text-xs text-text-muted">{hint}</p>}
    </div>
  );
}

SearchableSelect.propTypes = {
  label: PropTypes.string,
  options: PropTypes.arrayOf(
    PropTypes.shape({
      value: PropTypes.string.isRequired,
      label: PropTypes.string.isRequired,
    })
  ),
  value: PropTypes.string,
  onChange: PropTypes.func,
  placeholder: PropTypes.string,
  disabled: PropTypes.bool,
  required: PropTypes.bool,
  hint: PropTypes.string,
  className: PropTypes.string,
};
