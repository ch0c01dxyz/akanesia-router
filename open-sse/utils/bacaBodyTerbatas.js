// Baca body response secara terbatas (fail-open → string kosong).
// Setelah batas tercapai, stream di-cancel agar upstream berhenti mengirim
// (hemat bandwidth + waktu, bukan sekadar memotong hasil).
//
// Dipakai untuk body ERROR upstream: kode pemanggil hanya memakai ≤160 char
// pertama, jadi membaca lebih dari 16 KB tidak ada gunanya — dan
// `await response.text()` tanpa batas adalah risiko memory exhaustion
// (undici maxResponseSize default -1 = unbounded).
export const BATAS_BACA_BODY_ERROR = 16 * 1024;

export async function bacaBodyTerbatas(response, maxBytes = BATAS_BACA_BODY_ERROR) {
  try {
    const stream = response?.body;
    if (!stream || typeof stream.getReader !== "function") return "";
    const reader = stream.getReader();
    const decoder = new TextDecoder();
    let teks = "";
    let total = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done || !value) break;
        const sisa = maxBytes - total;
        if (sisa <= 0) break;
        const potong = value.subarray(0, Math.min(value.byteLength, sisa));
        teks += decoder.decode(potong, { stream: true });
        total += potong.byteLength;
        if (total >= maxBytes) break;
      }
      teks += decoder.decode();
    } finally {
      await reader.cancel().catch(() => {});
      reader.releaseLock();
    }
    return teks;
  } catch {
    return "";
  }
}
