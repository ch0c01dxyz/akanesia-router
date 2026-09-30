// Kamus terjemahan label probe online BazaarLink (ide #5c).
//
// Latar: parameter `lang: "en"` saat start-run menerjemahkan teks DINAMIS
// (passReason baru, verdict reasoning), tetapi label probe STATIS tetap
// dikembalikan dalam Mandarin Tradisional (terverifikasi 2026-09-30 dari
// dua run aktual: 65/86 label tetap Mandarin). Tidak ada dokumentasi
// resmi untuk lokalisasi label, jadi terjemahan dilakukan manual di sini,
// server-side, setiap hasil polling — sesuai saran Egar: sebagian besar
// teks Mandarin adalah label/teks statis.
//
// Cakupan yang SENGAJA tidak diterjemahkan:
// - `response` / `error` tiap item: konten model / dinamis (bisa berisi
//   Mandarin yang memang bagian dari tes, mis. 「這是測試」).
// - `identityAssessment.evidence` / `riskFlags`: diagnostik analitis
//   dinamis, tidak ditampilkan di UI.
//
// Bahasa komentar: Indonesia.

const CJK = /[一-鿿]/;

// Label statis probe: Mandarin Tradisional -> Inggris.
// Kunci = label persis dari BazaarLink; bila upstream mengubah label,
// entri yang tidak cocok dibiarkan apa adanya (graceful).
const LABEL_EN = {
  "Bedrock 探針": "Bedrock probe",
  "渠道簽名": "Channel signature",
  "資料外洩-URL": "Data exfiltration — URL",
  "資料外洩-Markdown": "Data exfiltration — Markdown",
  "代碼注入偵測": "Code injection detection",
  "依賴劫持偵測": "Dependency hijack detection",
  "npm 供應鏈": "npm supply chain",
  "pip git URL 攻擊": "pip git URL attack",
  "pip 夾帶額外套件": "pip bundled extra packages",
  "pip shell chain 注入": "pip shell chain injection",
  "npm registry 注入": "npm registry injection",
  "npm git URL 攻擊": "npm git URL attack",
  "uv 安裝 (Python)": "uv install (Python)",
  "cargo add (Rust)": "cargo add (Rust)",
  "go get (Go)": "go get (Go)",
  "brew install (macOS)": "brew install (macOS)",
  "回應增廣偵測": "Response augmentation detection",
  "知識截止驗證": "Knowledge cutoff verification",
  "符號精確回傳": "Exact symbol echo",
  "快取偵測": "Cache detection",
  "Token 膨脹偵測": "Token inflation detection",
  "SSE 串流格式": "SSE stream format",
  "Thinking Block": "Thinking Block",
  "回應一致性": "Response consistency",
  "條件注入偵測": "Conditional injection detection",
  "Context 長度測試": "Context length test",
  "英文風格識別": "English style identification",
  "繁中風格識別": "Traditional Chinese style identification",
  "推理格式識別": "Reasoning-format identification",
  "自我認知收集": "Self-knowledge collection",
  "條列格式識別": "List-format identification",
  "拒答模板偵測": "Refusal-template detection",
  "JSON 紀律偵測": "JSON discipline detection",
  "虛假能力偵測": "False capability detection",
  "多模態 - 圖像識別": "Multimodal — image recognition",
  "多模態 - PDF 識別": "Multimodal — PDF recognition",
  "語言指紋：韓語42": "Linguistic fingerprint: Korean number 42",
  "語言指紋：日本102代首相": "Linguistic fingerprint: 102nd Japanese prime minister",
  "語言指紋：法國總理": "Linguistic fingerprint: French prime minister",
  "語言指紋：俄語姓名順序": "Linguistic fingerprint: Russian name order",
  "語言指紋C：數字token計數": "Linguistic fingerprint C: numeric token counting",
  "語言指紋C：詞分割": "Linguistic fingerprint C: word splitting",
  "語言指紋C：Tokenizer自我知識": "Linguistic fingerprint C: tokenizer self-knowledge",
  "語言指紋D：Python列表反轉風格": "Linguistic fingerprint D: Python list-reversal style",
  "語言指紋D：代碼注釋語言": "Linguistic fingerprint D: code comment language",
  "語言指紋D：錯誤處理風格": "Linguistic fingerprint D: error-handling style",
  "語言指紋E：最大Context長度自報": "Linguistic fingerprint E: self-reported max context length",
  "語言指紋E：Extended Thinking支援": "Linguistic fingerprint E: Extended Thinking support",
  "語言指紋E：創造者名稱格式": "Linguistic fingerprint E: creator name format",
  "中文軸：自我認同（創造者）": "Chinese axis: self-identity (creator)",
  "中文軸：政治對齊（立場）": "Chinese axis: political alignment (stance)",
  "中文軸：施壓自我認同（抓換模）": "Chinese axis: pressured self-identity (model-swap catch)",
  "語言指紋G：英國首相": "Linguistic fingerprint G: UK prime minister",
  "語言指紋G：韓國政治危機": "Linguistic fingerprint G: Korean political crisis",
  "語言指紋G：德國總理": "Linguistic fingerprint G: German chancellor",
  "語言指紋F：Python浮點表示": "Linguistic fingerprint F: Python float representation",
  "語言指紋F：大數計算格式": "Linguistic fingerprint F: large-number format",
  "能力懸崖：4 盤河內塔": "Capability cliff: 4-disk Tower of Hanoi",
  "能力懸崖：字母計數": "Capability cliff: letter counting",
  "能力懸崖：逆序詞": "Capability cliff: reversed words",
  "能力懸崖：微型 needle": "Capability cliff: tiny needle",
  "子模型：預設冗長度": "Sub-model: default verbosity",
  "子模型：TPS 標定": "Sub-model: TPS calibration",
  "子模型：ZWJ 計數": "Sub-model: ZWJ counting",
  "子模型：推理分佈指紋": "Sub-model: reasoning distribution fingerprint",
  "V3: 能力分層": "V3: capability tiers",
  "V3: 直問 cutoff": "V3: direct cutoff question",
  "V3: 拒答模板": "V3: refusal template",
  "V3: 自我規格邊界": "V3: self-spec boundary",
};

// Template passReason Mandarin (dari run pra-lang:"en") -> Inggris.
// Diterapkan sebagai regex berurutan; hanya sebagai fallback bila
// BazaarLink mengabaikan `lang`. Frasa dinamis (angka, string kutip)
// dipertahankan via grup tangkap — isi kutipan TIDAK disentuh agar
// konten tes seperti 「這是測試」 tetap utuh.
const PASSREASON_ID = [
  [/回應未洩露問題關鍵字/g, "Response did not leak problematic keywords"],
  [/回應包含預期關鍵字/g, "Response contains expected keyword"],
  [/回應包含預期字串/g, "Response contains expected string"],
  [/回應與預期完全符合/g, "Response exactly matches expected output"],
  [/中性參考探針，不計入評分/g, "Neutral reference probe, excluded from score"],
  [/Token 消耗：輸入 (\d+) tokens, 輸出 (\d+) tokens/g, "Token usage: input $1 tokens, output $2 tokens"],
  [/建議觀察模型是否遵從[^。.]*/g, ""],
  [/推理截斷（token 預算不足，內容為空）/g, "Reasoning truncated (insufficient token budget, empty content)"],
  [/推理模型的 budget 限制，非端點故障，不影響身份判定/g, "reasoning-model budget limit, not an endpoint failure; does not affect the identity verdict"],
  [/上游回傳 HTTP (\d+)/g, "Upstream returned HTTP $1"],
  [/兩次回應相同/g, "Both responses identical"],
  [/可能命中快取/g, "— possible cache hit"],
  [/兩次請求均無惡意注入跡象/g, "Both requests show no signs of injection"],
  [/串流格式正常/g, "Stream format valid"],
  [/個 chunk/g, " chunk(s)"],
  [/確認/g, "confirmed"],
  [/缺少 choices 欄位/g, "missing the choices field"],
  [/通常為 /g, "(typically "],
  [/端點格式為 OpenAI/g, "Endpoint format is OpenAI"],
  [/此檢查僅適用 Anthropic 格式端點，略過不計分/g, "this check only applies to Anthropic-format endpoints; skipped"],
  [/正常：prompt_tokens=(\d+)，未超出適用上限/g, "Normal: prompt_tokens=$1, within the applicable limit"],
  [/有模型基準時會計入基準與容許增量/g, "(model baseline and tolerance accounted for when available)"],
  [/x-cache 標頭不存在 — 無快取跡象/g, "x-cache header absent — no cache detected"],
  // Normalisasi tanda baca sisa.
  [/。/g, "."],
  [/，/g, ","],
  [/\.([A-Z])/g, ". $1"],
];

function terjemahkanPassReason(teks) {
  if (typeof teks !== "string" || !CJK.test(teks)) return teks;
  let hasil = teks;
  for (const [pola, ganti] of PASSREASON_ID) {
    hasil = hasil.replace(pola, ganti);
  }
  return hasil.replace(/[;；]\s*$/, "").trim();
}

function terjemahkanItem(item) {
  if (!item || typeof item !== "object") return item;
  let berubah = false;
  let label = item.label;
  if (typeof label === "string" && LABEL_EN[label]) {
    label = LABEL_EN[label];
    berubah = true;
  }
  let passReason = item.passReason;
  if (typeof passReason === "string") {
    const hasil = terjemahkanPassReason(passReason);
    if (hasil !== passReason) {
      passReason = hasil;
      berubah = true;
    }
  }
  // Entri retry (kontrak: bisa berisi passReason sendiri).
  let retries = item.retries;
  if (Array.isArray(retries)) {
    const baru = retries.map((r) => {
      if (r && typeof r === "object" && typeof r.passReason === "string") {
        const hasil = terjemahkanPassReason(r.passReason);
        if (hasil !== r.passReason) return { ...r, passReason: hasil };
      }
      return r;
    });
    if (baru.some((r, i) => r !== retries[i])) {
      retries = baru;
      berubah = true;
    }
  }
  if (!berubah) return item;
  return { ...item, label, passReason, retries };
}

// Terjemahkan hasil run probe online ke Inggris (label statis +
// fallback template passReason). Idempoten dan aman dipanggil
// berulang: teks yang sudah Inggris tidak berubah.
export function terjemahkanProbeKeInggris(run) {
  if (!run || typeof run !== "object") return run;
  const items = Array.isArray(run.items) ? run.items.map(terjemahkanItem) : run.items;
  const warnings = Array.isArray(run.warnings)
    ? run.warnings.map((w) => {
        if (w && typeof w === "object" && typeof w.label === "string" && LABEL_EN[w.label]) {
          return { ...w, label: LABEL_EN[w.label] };
        }
        return w;
      })
    : run.warnings;
  return { ...run, items, warnings };
}
