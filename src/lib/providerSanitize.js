// Allowlist sanitasi koneksi provider untuk respons API.
// Mencegah secret (apiKey, clientSecret, mimoPassToken, dsb. — termasuk yang
// tersimpan di dalam providerSpecificData) bocor ke client via JSON.

export const SAFE_FIELDS = [
  "id", "provider", "authType", "name", "email", "displayName",
  "priority", "globalPriority", "isActive", "defaultModel",
  "testStatus", "lastError", "lastErrorAt", "errorCode",
  "expiresAt", "lastUsedAt", "consecutiveUseCount",
  "createdAt", "updatedAt",
];

export const SAFE_PSD_FIELDS = [
  "baseUrl", "azureEndpoint", "deployment", "apiVersion", "accountId",
  "region", "projectId", "resourceUrl", "proxyPoolId",
  "connectionProxyEnabled", "connectionProxyUrl", "connectionNoProxy",
  "githubLogin", "githubName", "githubEmail", "githubUserId",
  "username", "firstName", "lastName", "authMethod", "authKind",
  "profileArn",
];

// Field non-secret tambahan yang dipakai dashboard admin (bukan client umum).
const ADMIN_EXTRA_PSD_FIELDS = [
  "prefix", "customModels", "uid", "mimoUserId", "chatgptPlanType",
  "organization", "nodeName",
];

/**
 * Kembalikan salinan koneksi yang aman untuk respons API.
 * @param {object} c record koneksi (dari DB/repo)
 * @param {boolean} isAdmin true untuk route dashboard admin: sertakan field
 *   non-secret tambahan yang dipakai UI admin.
 */
export function sanitizeConnection(c, isAdmin = false) {
  const safe = {};
  for (const f of SAFE_FIELDS) if (c[f] !== undefined) safe[f] = c[f];
  if (c.providerSpecificData) {
    const fields = isAdmin
      ? [...SAFE_PSD_FIELDS, ...ADMIN_EXTRA_PSD_FIELDS]
      : SAFE_PSD_FIELDS;
    const psd = {};
    for (const f of fields) {
      if (c.providerSpecificData[f] !== undefined) psd[f] = c.providerSpecificData[f];
    }
    safe.providerSpecificData = psd;
  }
  return safe;
}
