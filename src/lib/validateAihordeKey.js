// Validasi API key AI Horde lewat endpoint terautentikasi.
// Endpoint models publik (oai.aihorde.net/v1/models) tidak butuh auth,
// sehingga key salah/expired pun lolos sebagai "valid" — endpoint ini yang benar.
// Fail-open: masalah jaringan/server TIDAK PERNAH dilaporkan sebagai key invalid.
export async function validateAihordeKey(apiKey, fetchFn = fetch) {
  try {
    const res = await fetchFn("https://aihorde.net/api/v2/find_user", {
      headers: { apikey: apiKey },
      signal: AbortSignal.timeout(8000),
    });
    if (res.status === 401 || res.status === 403) {
      return { valid: false, error: "API key AI Horde tidak valid atau sudah kedaluwarsa." };
    }
    if (!res.ok) {
      return unverified(`server menjawab HTTP ${res.status}`);
    }
    const json = await res.json().catch(() => null);
    const adaUserInfo = json && typeof json === "object" && ("id" in json || "username" in json);
    if (!adaUserInfo) {
      return unverified("respons tidak berisi info user");
    }
    return { valid: true, error: null };
  } catch (err) {
    return unverified(err?.message || "jaringan bermasalah");
  }
}

function unverified(reason) {
  return {
    valid: false,
    status: "unknown",
    error: `Tidak dapat memverifikasi API key AI Horde (${reason}). Periksa koneksi jaringan lalu coba lagi.`,
  };
}
