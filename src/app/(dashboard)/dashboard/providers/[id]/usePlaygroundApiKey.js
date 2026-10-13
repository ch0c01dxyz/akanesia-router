"use client";

import { useState, useEffect } from "react";

/**
 * Auto-load API key default (yang pertama & aktif) agar playground tetap
 * jalan walau setting global requireApiKey menyala. Bila belum ada key
 * sama sekali, otomatis provision satu ("Default Key").
 *
 * Pola fetch-on-open di useEffect ini disengaja (konvensi #10 AGENTS.md)
 * — jangan di-refactor ke handler atau library data-fetching.
 *
 * @returns {string} API key (string kosong bila belum termuat/gagal)
 */
export function usePlaygroundApiKey() {
  const [apiKey, setApiKey] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const fetchKeys = async () => {
          const res = await fetch("/api/keys", { cache: "no-store" });
          if (!res.ok) return [];
          const data = await res.json();
          return data.keys || [];
        };
        let keys = await fetchKeys();
        if (keys.length === 0) {
          try {
            const createRes = await fetch("/api/keys", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ name: "Default Key" }),
            });
            if (createRes.ok) keys = await fetchKeys();
          } catch { /* fall through */ }
        }
        const first = keys.find((k) => k.isActive !== false) || keys[0];
        // GET /api/keys mengembalikan key ter-mask (mengandung "•" yang tidak
        // valid di header HTTP) — ambil nilai penuh via endpoint reveal per key.
        if (!cancelled && first?.id) {
          try {
            const res = await fetch(`/api/keys/${first.id}`, { cache: "no-store" });
            if (res.ok) {
              const data = await res.json();
              if (!cancelled && data.key?.key) { setApiKey(data.key.key); return; }
            }
          } catch { /* fall through ke masked */ }
        }
        if (!cancelled && first?.key) setApiKey(first.key);
      } catch { /* playground tetap keyless; error server akan muncul sendiri */ }
    })();
    return () => { cancelled = true; };
  }, []);

  return apiKey;
}
