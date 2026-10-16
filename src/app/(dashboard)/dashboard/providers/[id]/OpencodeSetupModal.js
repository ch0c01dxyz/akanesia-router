"use client";

import { useState, useEffect } from "react";
import { Modal, Button } from "@/shared/components";

/**
 * Modal panduan setup opencode2 + auto-update dengan progress bar.
 * Muncul jika opencode2 belum terinstall atau ada update.
 */
export default function OpencodeSetupModal({ isOpen, onClose }) {
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [updating, setUpdating] = useState(false);
  const [progress, setProgress] = useState(0);
  const [updateLog, setUpdateLog] = useState([]);

  const checkStatus = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/opencode-bridge/status").then((r) => r.json());
      setStatus(res);
    } catch {
      setStatus({ error: "Gagal cek status" });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!isOpen) return;
    checkStatus();
  }, [isOpen]);

  const startUpdate = async () => {
    setUpdating(true);
    setProgress(0);
    setUpdateLog([]);
    await fetch("/api/opencode-bridge/update", { method: "POST" });
    // Poll progress
    const poll = setInterval(async () => {
      const res = await fetch("/api/opencode-bridge/update").then((r) => r.json());
      setProgress(res.progress || 0);
      setUpdateLog(res.log || []);
      if (res.status === "done" || res.status === "error") {
        clearInterval(poll);
        setUpdating(false);
        // Refresh status setelah update
        const s = await fetch("/api/opencode-bridge/status").then((r) => r.json());
        setStatus(s);
      }
    }, 1000);
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Setup opencode2">
      {loading && <p className="text-sm text-text-muted">Mengecek status...</p>}

      {!loading && status && (
        <div className="space-y-4">
          {status.installed ? (
            <div>
              <p className="text-sm">
                ✅ opencode2 terinstall
                {status.version && <span className="ml-2 text-text-muted">v{status.version}</span>}
              </p>
              <p className="mt-1 text-xs text-text-muted">{status.path}</p>
            </div>
          ) : (
            <div>
              <p className="text-sm font-medium text-amber-600">
                ⚠️ opencode2 belum terinstall
              </p>
              {status.setupGuide && (
                <div className="mt-3">
                  <p className="text-sm font-medium">{status.setupGuide.title}</p>
                  <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm">
                    {status.setupGuide.steps.map((step, i) => (
                      <li key={i} className="font-mono text-xs">{step}</li>
                    ))}
                  </ol>
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={checkStatus}
                    disabled={loading}
                    className="mt-3"
                  >
                    {loading ? "Mengecek..." : "🔄 Re-check"}
                  </Button>
                </div>
              )}
            </div>
          )}

          {/* Update section */}
          <div className="border-t border-border pt-4">
            <p className="text-sm font-medium">Update opencode2</p>
            <p className="mt-1 text-xs text-text-muted">
              Disarankan update dulu sebelum menjalankan bridge.
            </p>
            {!updating ? (
              <Button size="sm" onClick={startUpdate} className="mt-2">
                Update Sekarang
              </Button>
            ) : (
              <div className="mt-2">
                <div className="h-2 w-full overflow-hidden rounded-full bg-gray-200">
                  <div
                    className="h-full rounded-full bg-blue-600 transition-all"
                    style={{ width: `${progress}%` }}
                  />
                </div>
                <p className="mt-1 text-xs text-text-muted">{progress}%</p>
                <div className="mt-2 max-h-32 overflow-y-auto rounded bg-black p-2 font-mono text-xs text-green-400">
                  {updateLog.map((line, i) => (
                    <div key={i}>{line}</div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </Modal>
  );
}
