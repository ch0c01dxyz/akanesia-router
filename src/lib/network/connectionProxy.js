import { getProxyPoolById } from "@/models";

// Safely normalize any value into a trimmed string.
function normalizeString(value) {
  if (value === undefined || value === null) return "";
  return String(value).trim();
}

// ─── Proxy pool rotation state (in-memory) ─────────────────────────
const rotateState = new Map(); // providerId → { index }

/**
 * Pick one proxy pool ID from a list based on strategy.
 * round-robin: cycle sequentially (in-memory, resets on restart)
 * random:      uniform random pick
 * none/single: return first entry
 */
export function pickProxyPoolId(poolIds, strategy, providerId) {
  if (!poolIds || poolIds.length === 0) return null;
  if (poolIds.length === 1) return poolIds[0];

  if (strategy === "round-robin") {
    const state = rotateState.get(providerId) || { index: -1 };
    state.index = (state.index + 1) % poolIds.length;
    rotateState.set(providerId, state);
    return poolIds[state.index];
  }

  if (strategy === "random") {
    return poolIds[Math.floor(Math.random() * poolIds.length)];
  }

  return poolIds[0]; // "none" or unknown
}

/**
 * Normalize legacy proxy configuration.
 */
function normalizeLegacyProxy(providerSpecificData = {}) {
  const connectionProxyEnabled =
    providerSpecificData?.connectionProxyEnabled === true;

  const connectionProxyUrl = normalizeString(
    providerSpecificData?.connectionProxyUrl
  );

  const connectionNoProxy = normalizeString(
    providerSpecificData?.connectionNoProxy
  );

  return {
    connectionProxyEnabled,
    connectionProxyUrl,
    connectionNoProxy,
  };
}

/**
 * Resolve final proxy configuration.
 *
 * Priority:
 * 1. Proxy Pool
 * 2. Legacy Proxy
 * 3. No Proxy
 */
export async function resolveConnectionProxyConfig(
  providerSpecificData = {}
) {
  try {
    const proxyPoolIdRaw = normalizeString(
      providerSpecificData?.proxyPoolId
    );

    // "__none__" means explicitly disabled
    const proxyPoolId =
      proxyPoolIdRaw === "__none__" ? "" : proxyPoolIdRaw;

    const legacy = normalizeLegacyProxy(providerSpecificData);

    // Pool strict harus mempertahankan jaminannya meski pool-nya sendiri tidak
    // bisa dipakai (nonaktif, atau tersimpan tanpa url). Kalau tidak, jalur
    // pool-tak-valid di bawah melaporkan strictProxy:false dan request diam-diam
    // keluar lewat IP langsung — kebocoran yang justru ingin dicegah mode strict (#4333).
    let poolStrictProxy = false;
    // Diisi bila pool diminta tapi tidak valid — diteruskan ke return agar
    // pemanggil bisa fail-closed (500 + Console Log), bukan fail-open diam-diam.
    let poolConfigError = null;

    /**
     * -----------------------------
     * Proxy Pool Resolution
     * -----------------------------
     */
    if (proxyPoolId) {
      const proxyPool = await getProxyPoolById(proxyPoolId);

      const proxyUrl = normalizeString(proxyPool?.proxyUrl);
      const noProxy = normalizeString(proxyPool?.noProxy);

      const isValidPool =
        proxyPool &&
        proxyPool.isActive === true &&
        proxyUrl;

      poolStrictProxy = proxyPool?.strictProxy === true;

      // Pool diminta tapi tidak valid (tidak ditemukan / nonaktif / tanpa URL):
      // tandai error agar pemanggil bisa fail-closed (500 + Console Log),
      // bukan diam-diam fail-open ke direct. Pesan ini tidak mengandung secret.
      if (!isValidPool) {
        poolConfigError = `Pool proxy "${proxyPoolId}" tidak valid (tidak ditemukan, nonaktif, atau tanpa URL)`;
      }

      if (isValidPool) {
        /**
         * Vercel/Cloudflare/Deno/Netlify relay proxies use base URL rewriting
         * instead of HTTP_PROXY environment variables.
         */
        if (proxyPool.type === "vercel" || proxyPool.type === "cloudflare" || proxyPool.type === "deno" || proxyPool.type === "netlify") {
          return {
            source: proxyPool.type,

            proxyPoolId,
            proxyPool,

            connectionProxyEnabled: false,
            connectionProxyUrl: "",
            connectionNoProxy: noProxy,

            strictProxy: proxyPool.strictProxy === true,

            vercelRelayUrl: proxyUrl, // Still mapped to vercelRelayUrl in the unified payload since they use the exact same header spec
          };
        }

        /**
         * Standard proxy pool
         */
        return {
          source: "pool",

          proxyPoolId,
          proxyPool,

          connectionProxyEnabled: true,
          connectionProxyUrl: proxyUrl,
          connectionNoProxy: noProxy,

          strictProxy: proxyPool.strictProxy === true,
        };
      }
    }

    /**
     * -----------------------------
     * Legacy Proxy Fallback
     * -----------------------------
     */
    if (
      legacy.connectionProxyEnabled &&
      legacy.connectionProxyUrl
    ) {
      return {
        source: "legacy",

        proxyPoolId: proxyPoolId || null,
        proxyPool: null,

        strictProxy: poolStrictProxy,
        // Pool diminta tapi rusak — legacy menanggung, tapi masalah pool
        // tetap dilaporkan agar admin tahu (lihat proxyConfigError).
        ...(poolConfigError ? { proxyConfigError: poolConfigError } : {}),

        ...legacy,
      };
    }

    /**
     * -----------------------------
     * No Proxy Config
     * -----------------------------
     */
    return {
      source: "none",

      proxyPoolId: proxyPoolId || null,
      proxyPool: null,

      strictProxy: poolStrictProxy,
      ...(poolConfigError ? { proxyConfigError: poolConfigError } : {}),

      ...legacy,
    };
  } catch (error) {
    console.error(
      "[resolveConnectionProxyConfig] Failed to resolve proxy config:",
      error
    );

    // DB error: hanya tandai error bila proxy memang dimaksudkan
    // (pool diminta atau legacy aktif) — kalau tidak, "none" adalah normal.
    const poolIdRaw = normalizeString(providerSpecificData?.proxyPoolId);
    const proxyWasIntended =
      !!poolIdRaw && poolIdRaw !== "__none__";
    const legacyCfg = normalizeLegacyProxy(providerSpecificData);
    const legacyWasEnabled = !!(
      legacyCfg.connectionProxyEnabled && legacyCfg.connectionProxyUrl
    );

    return {
      source: "error",

      proxyPoolId: null,
      proxyPool: null,

      connectionProxyEnabled: false,
      connectionProxyUrl: "",
      connectionNoProxy: "",

      strictProxy: false,
      ...((proxyWasIntended || legacyWasEnabled)
        ? { proxyConfigError: `Gagal membaca konfigurasi proxy: ${error?.message || error}` }
        : {}),
    };
  }
}
