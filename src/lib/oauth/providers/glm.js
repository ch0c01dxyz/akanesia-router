import crypto from "crypto";
import { GLM_OAUTH_CONFIG } from "../constants/oauth.js";

// Zai GLM Coding OAuth — CLI polling flow (mirip ZCode CLI resmi):
//
//   1) POST {cliInitUrl}   Authorization: Bearer <pollToken>  {"provider":"zai"}
//        → { code: 0, data: { authorize_url, flow_id, poll_interval_sec, expires_at } }
//   2) Browser membuka authorize_url; user sign in dengan akun Z.ai
//   3) GET {cliPollUrl}/<flow_id>   Authorization: Bearer <pollToken>
//        → { data: { status: "pending" } } sampai
//          { data: { status: "ready", token, user, accessToken, refreshToken? } }
//   4) accessToken (token OAuth Z.AI) → POST {businessLoginUrl} {"token": ...}
//        → { data: { access_token } } (platform business JWT)
//   5) Business JWT → coding-plan API key via getCustomerInfo → api_keys
//      list/create("zcode-api-key") → copy → "apiKey.secretKey"
//
// Coding-plan API key adalah kredensial model yang long-lived; provider ZAI
// OAuth tidak punya refresh_token grant, jadi expiry = login ulang (sama
// seperti CLI resmi). zcode JWT + business token ikut di providerSpecificData
// untuk quota/usage dan debugging.
const glm = {
  config: GLM_OAUTH_CONFIG,
  flowType: "device_code",
  requestDeviceCode: async (config) => {
    const pollToken = crypto.randomBytes(32).toString("hex");
    const response = await fetch(config.cliInitUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${pollToken}`,
      },
      body: JSON.stringify({ provider: config.providerId || "zai" }),
    });
    if (!response.ok) {
      const error = await response.text();
      throw new Error(`ZCode OAuth init failed: ${error}`);
    }
    const payload = await response.json();
    if (!isSuccessCode(payload.code) || !payload.data) {
      throw new Error(payload.msg || "ZCode OAuth init returned no data");
    }
    const data = payload.data;
    if (!data.flow_id || !data.authorize_url) {
      throw new Error("ZCode OAuth init response missing flow_id/authorize_url");
    }
    return {
      device_code: data.flow_id,
      verification_uri: data.authorize_url,
      // expires_at adalah waktu absolut upstream; tampilkan deadline relatif untuk UI
      expires_in: relativeSeconds(data.expires_at) ?? 300,
      interval: data.poll_interval_sec || 3,
      _zcodePollToken: pollToken,
    };
  },
  pollToken: async (config, deviceCode, _codeVerifier, extraData) => {
    const pollToken = extraData?._zcodePollToken;
    if (!pollToken) {
      return {
        ok: true,
        data: {
          error: "access_denied",
          error_description: "Missing ZCode poll token — restart the login flow",
        },
      };
    }

    let response;
    try {
      response = await fetch(`${config.cliPollUrl}/${encodeURIComponent(deviceCode)}`, {
        headers: { Authorization: `Bearer ${pollToken}` },
      });
    } catch (error) {
      // Gangguan jaringan transient (DNS/timeout) — jangan bunuh login,
      // biarkan polling lanjut sampai deadline.
      return {
        ok: true,
        data: {
          error: "authorization_pending",
          error_description: `Gangguan jaringan saat poll: ${error.message}`,
        },
      };
    }
    if (!response.ok) {
      // 429/5xx transient → tetap polling; 4xx lain berarti kredensial/flow
      // bermasalah → hentikan dengan access_denied.
      if (response.status === 429 || response.status >= 500) {
        return {
          ok: true,
          data: {
            error: "authorization_pending",
            error_description: `ZCode poll transient (HTTP ${response.status}), mencoba lagi`,
          },
        };
      }
      return {
        ok: true,
        data: {
          error: "access_denied",
          error_description: `ZCode poll failed (HTTP ${response.status})`,
        },
      };
    }

    const payload = await response.json();
    if (!isSuccessCode(payload.code)) {
      return {
        ok: true,
        data: { error: "access_denied", error_description: payload.msg || "ZCode poll failed" },
      };
    }

    const data = payload.data || {};
    if (data.status === "pending") {
      return { ok: true, data: { error: "authorization_pending" } };
    }
    if (data.status === "failed") {
      return {
        ok: true,
        data: {
          error: "access_denied",
          error_description: "ZCode authorization failed or was cancelled",
        },
      };
    }
    if (data.status !== "ready") {
      return {
        ok: true,
        data: { error: "authorization_pending", error_description: `Unknown status: ${data.status}` },
      };
    }

    // payload ready menempatkan token OAuth ZAI di bawah data[providerId]:
    // { status:"ready", token, user, zai: { access_token, refresh_token? } }.
    // Fallback ke field top-level untuk ketahanan terhadap drift payload.
    const providerData = data[config.providerId] || data[data.providerId] || {};
    const zaiAccessToken =
      providerData.access_token ||
      providerData.accessToken ||
      data.accessToken ||
      data.access_token;
    if (!zaiAccessToken) {
      return {
        ok: true,
        data: {
          error: "access_denied",
          error_description: "ZCode poll response missing access token",
        },
      };
    }

    // ready.accessToken adalah token OAuth Z.AI — turunkan coding-plan API key.
    // Device code sudah terpakai di titik ini, jadi kegagalan di sini tidak
    // bisa pulih via polling ulang: kembalikan error eksplisit (bukan throw,
    // yang hanya menghasilkan "Authorization timeout" menyesatkan di deadline).
    let planApiKey;
    let businessToken;
    try {
      ({ planApiKey, businessToken } = await resolveCodingPlanApiKey(config, zaiAccessToken));
    } catch (error) {
      return {
        ok: true,
        data: {
          error: "exchange_failed",
          error_description: `Gagal membuat coding-plan API key: ${error.message}`,
        },
      };
    }

    return {
      ok: true,
      data: {
        access_token: planApiKey,
        _zcodeJwtToken: data.token || "",
        _zaiBusinessToken: businessToken,
        _zaiRefreshToken:
          providerData.refresh_token || providerData.refreshToken || data.refresh_token || data.refreshToken || "",
        _zcodeUser: data.user || {},
      },
    };
  },
  mapTokens: (tokens) => {
    const user = tokens._zcodeUser || {};
    const displayName = user.name || user.email || null;
    return {
      accessToken: tokens.access_token,
      refreshToken: null,
      email: user.email || null,
      ...(displayName ? { displayName } : {}),
      providerSpecificData: {
        authMethod: "cli_poll",
        username: user.name || undefined,
        userId: user.user_id || undefined,
        zcodeJwtToken: tokens._zcodeJwtToken || undefined,
        zaiBusinessToken: tokens._zaiBusinessToken || undefined,
        ...(tokens._zaiRefreshToken ? { zaiRefreshToken: tokens._zaiRefreshToken } : {}),
      },
    };
  },
};

// Business JWT → coding-plan API key ("apiKey.secretKey"):
// getCustomerInfo → org/project default → api_keys list/create("zcode-api-key")
// → copy → secretKey.
async function resolveCodingPlanApiKey(config, zaiAccessToken) {
  const businessToken = await exchangeBusinessToken(config, zaiAccessToken);
  const authHeaders = {
    Authorization: `Bearer ${businessToken}`,
    "Content-Type": "application/json",
  };

  const customerInfo = await fetchBusinessJson(
    `${config.apiBaseUrl}/api/biz/customer/getCustomerInfo`,
    { headers: authHeaders },
    "customer info"
  );
  const location = pickOrgAndProject(customerInfo);
  if (!location) {
    throw new Error("Unable to resolve Z.ai organization and project for the coding plan");
  }

  const listUrl =
    `${config.apiBaseUrl}/api/biz/v1/organization/${location.organizationId}` +
    `/projects/${location.projectId}/api_keys`;
  const keys = (await fetchBusinessJson(listUrl, { headers: authHeaders }, "api keys")) || [];
  let keyEntry = Array.isArray(keys)
    ? keys.find((item) => item?.name === config.planApiKeyName)
    : null;
  if (!keyEntry) {
    keyEntry = await fetchBusinessJson(
      listUrl,
      {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({ name: config.planApiKeyName }),
      },
      "api key create"
    );
  }

  const apiKey = keyEntry?.apiKey?.trim();
  if (!apiKey) {
    throw new Error("Z.ai api_keys response is missing apiKey");
  }

  const secret = await fetchBusinessJson(
    `${listUrl}/copy/${encodeURIComponent(apiKey)}`,
    { headers: authHeaders },
    "api key copy"
  );
  const secretKey = secret?.secretKey?.trim();
  if (!secretKey) {
    throw new Error("Z.ai api key copy response is missing secretKey");
  }

  return { planApiKey: `${apiKey}.${secretKey}`, businessToken };
}

// POST {businessLoginUrl} {"token": <zai oauth token>} → { data: { access_token } }
async function exchangeBusinessToken(config, zaiAccessToken) {
  const payload = await fetchBusinessJson(
    config.businessLoginUrl,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: zaiAccessToken }),
    },
    "Z.ai business login"
  );
  const token = payload?.access_token?.trim() || payload?.accessToken?.trim();
  if (!token) {
    throw new Error("Z.ai business login response is missing access_token");
  }
  return token;
}

// Endpoint business menjawab {code, msg, data}; code 0/200 (atau absen) = sukses.
// data dikembalikan langsung (null bila tidak ada).
async function fetchBusinessJson(url, options, label) {
  const response = await fetch(url, options);
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Z.ai ${label} request failed (HTTP ${response.status}): ${text.slice(0, 200)}`);
  }
  let payload;
  try {
    payload = JSON.parse(text);
  } catch {
    throw new Error(`Z.ai ${label} response is not valid JSON`);
  }
  if (!isSuccessCode(payload?.code) || payload?.success === false) {
    throw new Error(payload?.msg || `Z.ai ${label} returned business error ${payload?.code}`);
  }
  return payload?.data ?? payload ?? null;
}

// Pilih org bernama "默认机构"/"default" dan project non-team bernama
// "默认项目"/"default" (projectType "2" = team), fallback ke entri pertama.
function pickOrgAndProject(customerInfo) {
  const organizations = Array.isArray(customerInfo?.organizations)
    ? customerInfo.organizations
    : [];
  const personalOrgs = organizations
    .map((organization) => ({
      organization,
      projects: (organization?.projects || []).filter(
        (project) => String(project?.projectType ?? "").trim() !== "2"
      ),
    }))
    .filter(({ organization, projects }) =>
      Boolean(organization?.organizationId && projects.length)
    );
  if (!personalOrgs.length) return null;

  const org =
    personalOrgs.find(({ organization }) => isDefaultName(organization.organizationName)) ||
    personalOrgs[0];
  const project =
    org.projects.find((item) => isDefaultName(item?.projectName)) || org.projects[0];
  if (!org.organization?.organizationId || !project?.projectId) return null;
  return { organizationId: org.organization.organizationId, projectId: project.projectId };
}

function isDefaultName(name) {
  const normalized = String(name || "").trim().toLowerCase();
  return normalized.includes("默认机构") || normalized.includes("默认项目") || normalized === "default";
}

function isSuccessCode(code) {
  return code === undefined || code === null || code === 0 || code === 200 || code === "0" || code === "200";
}

// Epoch absolut (detik atau ms) → detik dari sekarang; null bila absen/invalid.
function relativeSeconds(expiresAt) {
  const raw = Number(expiresAt);
  if (!Number.isFinite(raw) || raw <= 0) return null;
  const ms = raw > 1e12 ? raw : raw * 1000;
  const seconds = Math.floor((ms - Date.now()) / 1000);
  return seconds > 0 ? seconds : null;
}

export default glm;
