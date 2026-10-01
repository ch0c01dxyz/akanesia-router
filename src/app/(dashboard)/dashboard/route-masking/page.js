"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import {
  Card,
  Button,
  Modal,
  Input,
  SearchableSelect,
  CardSkeleton,
} from "@/shared/components";
import { useCopyToClipboard } from "@/shared/hooks/useCopyToClipboard";

// Validasi ringan di sisi klien (cerminan validateRouteMaskInput di server).
// Server tetap menjadi otoritas final — error API selalu ditampilkan.
const ALIAS_REGEX = /^[a-zA-Z0-9_.\-]+\/[^\s]+$/;
const ALIAS_MAX_LENGTH = 128;

function clientValidate(alias, target, existingAliases, originalAlias = null) {
  const nama = (alias || "").trim();
  if (!nama) return "Nama samaran wajib diisi.";
  if (nama.length > ALIAS_MAX_LENGTH) return `Nama samaran maksimal ${ALIAS_MAX_LENGTH} karakter.`;
  if (!ALIAS_REGEX.test(nama)) return "Nama samaran harus berformat \"prefix/model\" (contoh: routerlokal/glm-5.3-flash).";
  if (!target) return "Model target wajib dipilih.";
  // Syarat Egar: nama samaran tidak boleh SAMA PERSIS dengan model asli.
  if (nama.toLowerCase() === String(target).trim().toLowerCase()) {
    return "Masking model should be different than model real name";
  }
  // Nama samaran tidak boleh dipakai oleh mask lain (kecuali dirinya sendiri saat edit).
  const bentrok = (existingAliases || []).some(
    (m) => m.alias.toLowerCase() === nama.toLowerCase() && m.alias !== originalAlias
  );
  if (bentrok) return `Nama samaran "${nama}" sudah dipakai mask lain.`;
  return null;
}

export default function RouteMaskingPage() {
  const [masks, setMasks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modelOptions, setModelOptions] = useState([]);
  const [modelsLoading, setModelsLoading] = useState(false);

  const [showModal, setShowModal] = useState(false);
  const [editingAlias, setEditingAlias] = useState(null); // null = tambah baru
  const [formAlias, setFormAlias] = useState("");
  const [formTarget, setFormTarget] = useState("");
  const [formError, setFormError] = useState("");
  const [saving, setSaving] = useState(false);

  const [deletingAlias, setDeletingAlias] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState("");
  const [loadError, setLoadError] = useState("");
  const [modelsError, setModelsError] = useState(false);

  const { copied, copy } = useCopyToClipboard(2000);

  const fetchMasks = useCallback(async () => {
    try {
      const res = await fetch("/api/models/alias", { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const list = Object.entries(data.aliases || {}).map(([alias, target]) => ({
        alias,
        target: typeof target === "string" ? target : "",
      }));
      list.sort((a, b) => a.alias.localeCompare(b.alias));
      setMasks(list);
      setLoadError("");
    } catch (error) {
      console.log("Gagal memuat route-masking:", error);
      setLoadError("Gagal memuat daftar route-masking.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
// eslint-disable-next-line react-hooks/set-state-in-effect -- disengaja: fetch awal saat halaman dibuka; jangan di-refactor
    fetchMasks();
  }, [fetchMasks]);

  // Daftar model untuk selectbox: HANYA dari /v1/models yang sudah terfilter
  // kredensial di server (koneksi aktif + punya apiKey/token). Nama samaran
  // dan combo dikecualikan agar tidak terjadi chaining.
  const fetchModelOptions = useCallback(async () => {
    setModelsLoading(true);
    try {
      const res = await fetch("/api/v1/models", { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const opts = (data.data || [])
        .filter((m) => m?.id && m.id.includes("/") && m.owned_by !== "route-masking" && m.owned_by !== "combo")
        .map((m) => ({ value: m.id, label: m.id }))
        .sort((a, b) => a.label.localeCompare(b.label));
      setModelOptions(opts);
      setModelsError(false);
    } catch (error) {
      console.log("Gagal memuat daftar model:", error);
      setModelOptions([]);
      setModelsError(true);
    } finally {
      setModelsLoading(false);
    }
  }, []);

  const openAddModal = () => {
    setEditingAlias(null);
    setFormAlias("");
    setFormTarget("");
    setFormError("");
    setShowModal(true);
    fetchModelOptions();
  };

  const openEditModal = (mask) => {
    setEditingAlias(mask.alias);
    setFormAlias(mask.alias);
    setFormTarget(mask.target);
    setFormError("");
    setShowModal(true);
    fetchModelOptions();
  };

  const closeModal = () => {
    if (saving) return;
    setShowModal(false);
    setFormError("");
  };

  const handleSave = async () => {
    const err = clientValidate(formAlias, formTarget, masks, editingAlias);
    if (err) {
      setFormError(err);
      return;
    }
    setSaving(true);
    setFormError("");
    try {
      const nama = formAlias.trim();
      // Rename atomik di server: kirim renameFrom, server tulis-baru +
      // hapus-lama dalam satu transaksi sehingga tidak ada data loss.
      const res = await fetch("/api/models/alias", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          alias: nama,
          model: formTarget.trim(),
          ...(editingAlias ? { renameFrom: editingAlias } : {}),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Gagal menyimpan route-masking.");
      setShowModal(false);
      await fetchMasks();
    } catch (error) {
      // Tampilkan error API apa adanya (termasuk "Masking model should be
      // different than model real name" dari server).
      setFormError(error.message);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!deletingAlias) return;
    setDeleting(true);
    setDeleteError("");
    try {
      const res = await fetch(`/api/models/alias?alias=${encodeURIComponent(deletingAlias)}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Gagal menghapus route-masking.");
      }
      setDeletingAlias(null);
      await fetchMasks();
    } catch (error) {
      setDeleteError(error.message);
    } finally {
      setDeleting(false);
    }
  };

  const selectedTargetLabel = useMemo(
    () => modelOptions.find((o) => o.value === formTarget)?.label || formTarget,
    [modelOptions, formTarget]
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-text-main">Route-Masking</h1>
          <p className="text-sm text-text-muted mt-1 max-w-2xl">
            Panggil model dengan nama samaran. Gateway me-routing ke model asli,
            dan respons tetap menampilkan nama model asli. Cocok untuk agent
            harness yang memakai nama model stabil.
          </p>
        </div>
        <Button onClick={openAddModal}>
          <span className="material-symbols-outlined text-[18px]">add</span>
          Tambah Mask
        </Button>
      </div>

      {loading ? (
        <CardSkeleton />
      ) : (
        <Card>
          {loadError ? (
            <div className="py-12 text-center">
              <span className="material-symbols-outlined text-5xl text-red-500/40">error</span>
              <p className="mt-3 text-text-main">{loadError}</p>
              <Button className="mt-4" variant="outline" onClick={fetchMasks}>
                <span className="material-symbols-outlined text-[18px]">refresh</span>
                Coba lagi
              </Button>
            </div>
          ) : masks.length === 0 ? (
            <div className="py-12 text-center">
              <span className="material-symbols-outlined text-5xl text-text-muted/40">alt_route</span>
              <p className="mt-3 text-text-muted">Belum ada route-masking.</p>
              <p className="text-sm text-text-muted/70 mt-1">
                Tambahkan mask pertama: pilih model dari daftar, atur nama samarannya, selesai.
              </p>
              <Button className="mt-4" onClick={openAddModal}>
                <span className="material-symbols-outlined text-[18px]">add</span>
                Tambah Mask
              </Button>
            </div>
          ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-text-muted border-b border-border">
                  <th className="py-2.5 pr-4 font-medium">Nama Samaran</th>
                  <th className="py-2.5 pr-4 font-medium">Model Target</th>
                  <th className="py-2.5 font-medium text-right">Aksi</th>
                </tr>
              </thead>
              <tbody>
                {masks.map((mask) => (
                  <tr key={mask.alias} className="border-b border-border/50 last:border-0">
                    <td className="py-2.5 pr-4">
                      <button
                        type="button"
                        onClick={() => copy(mask.alias, mask.alias)}
                        title="Salin nama samaran"
                        className="font-mono text-primary hover:underline"
                      >
                        {mask.alias}
                      </button>
                      {copied === mask.alias && (
                        <span className="ml-2 text-xs text-text-muted">tersalin</span>
                      )}
                    </td>
                    <td className="py-2.5 pr-4">
                      <span className="font-mono text-text-main">{mask.target}</span>
                    </td>
                    <td className="py-2.5 text-right whitespace-nowrap">
                      <Button variant="ghost" size="sm" onClick={() => openEditModal(mask)} title="Ubah">
                        <span className="material-symbols-outlined text-[18px]">edit</span>
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          setDeleteError("");
                          setDeletingAlias(mask.alias);
                        }}
                        title="Hapus"
                        className="text-red-500 hover:text-red-600"
                      >
                        <span className="material-symbols-outlined text-[18px]">delete</span>
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          )}
        </Card>
      )}

      {/* Modal tambah / edit */}
      <Modal
        isOpen={showModal}
        onClose={closeModal}
        title={editingAlias ? "Ubah Route-Masking" : "Tambah Route-Masking"}
        footer={
          <>
            <Button variant="ghost" onClick={closeModal} disabled={saving}>
              Batal
            </Button>
            <Button onClick={handleSave} loading={saving} disabled={modelsLoading}>
              Simpan
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <SearchableSelect
            label="Model Target"
            required
            placeholder={modelsLoading ? "Memuat daftar model…" : "Cari model…"}
            disabled={modelsLoading}
            options={modelOptions}
            value={formTarget}
            onChange={(val) => {
              setFormTarget(val);
              // Saran otomatis nama samaran saat field masih kosong.
              if (!formAlias.trim() && val && val.includes("/")) {
                const modelPart = val.slice(val.indexOf("/") + 1);
                if (modelPart) setFormAlias(`routerlokal/${modelPart}`);
              }
            }}
            hint="Hanya model dari koneksi aktif berkredensial yang tampil di sini."
          />
          {modelsError && (
            <p className="text-xs text-amber-600 -mt-2">
              Gagal memuat daftar model. Tutup lalu buka ulang modal ini untuk mencoba lagi.
            </p>
          )}
          {formTarget && !modelOptions.some((o) => o.value === formTarget) && (
            <p className="text-xs text-amber-600 -mt-2">
              Target saat ini ({selectedTargetLabel}) tidak ada di daftar — mungkin koneksinya
              sudah tidak aktif. Pilih ulang bila perlu.
            </p>
          )}
          <Input
            label="Nama Samaran"
            required
            placeholder="mis. routerlokal/glm-5.3-flash"
            value={formAlias}
            onChange={(e) => setFormAlias(e.target.value)}
            hint="Format prefix/model. Prefix boleh virtual (mis. routerlokal) atau sama dengan provider asli."
          />
          {formError && (
            <div className="rounded-lg bg-red-500/10 border border-red-500/30 px-3 py-2 text-sm text-red-600">
              {formError}
            </div>
          )}
        </div>
      </Modal>

      {/* Konfirmasi hapus */}
      <Modal
        isOpen={!!deletingAlias}
        onClose={() => !deleting && setDeletingAlias(null)}
        title="Hapus Route-Masking"
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => !deleting && setDeletingAlias(null)} disabled={deleting}>
              Batal
            </Button>
            <Button variant="danger" onClick={handleDelete} loading={deleting}>
              Hapus
            </Button>
          </>
        }
      >
        <p className="text-text-muted">
          {`Hapus nama samaran "${deletingAlias}"? Harness yang masih memakainya akan gagal routing.`}
        </p>
        {deleteError && (
          <div className="mt-3 rounded-lg bg-red-500/10 border border-red-500/30 px-3 py-2 text-sm text-red-600">
            {deleteError}
          </div>
        )}
      </Modal>
    </div>
  );
}
