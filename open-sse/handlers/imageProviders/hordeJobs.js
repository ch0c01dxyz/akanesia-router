import adapter from "./aihorde.js";
import { HORDE_HTTP_TIMEOUT_MS, HORDE_MAX_JSON_BYTES, HORDE_MAX_IMAGE_BYTES, HORDE_IMAGE_HOSTS } from "../../config/hordeImageJobs.js";

export async function readBoundedBody(response, limit) {
  const declared = response.headers.get("content-length");
  if (declared && (!/^\d+$/.test(declared) || Number(declared) > limit)) {
    await response.body?.cancel();
    throw new Error("RESPONSE_TOO_LARGE");
  }
  const reader = response.body?.getReader();
  if (!reader) throw new Error("EMPTY_RESPONSE");
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) throw new Error("RESPONSE_TOO_LARGE");
      chunks.push(value);
    }
    return Buffer.concat(chunks, size);
  } catch (error) {
    await reader.cancel().catch(() => {});
    throw error;
  } finally {
    reader.releaseLock();
  }
}

const validId = (id) => typeof id === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id);

export function createHordeJobProvider({ fetchFn = fetch } = {}) {
  async function json(url, credentials, init = {}) {
    const response = await fetchFn(url, {
      ...init,
      headers: adapter.buildHeaders(credentials),
      redirect: "error",
      signal: AbortSignal.timeout(HORDE_HTTP_TIMEOUT_MS),
    });
    if (!response.ok) {
      await response.body?.cancel();
      return { httpStatus: response.status };
    }
    const value = JSON.parse((await readBoundedBody(response, HORDE_MAX_JSON_BYTES)).toString("utf8"));
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("INVALID_PROVIDER_RESPONSE");
    return { value };
  }

  const endpoint = (kind, id) => {
    if (!validId(id)) throw new Error("INVALID_PROVIDER_JOB");
    return `${adapter.buildUrl().replace(/\/generate\/async$/, "")}/generate/${kind}/${id}`;
  };

  return {
    async submit(model, prompt, credentials) {
      const result = await json(adapter.buildUrl(), credentials, {
        method: "POST", body: JSON.stringify(adapter.buildBody(model, { prompt, n: 1 })),
      });
      if (result.httpStatus) {
        // Only a definite rejection proves that a job was not accepted.
        return { state: [400, 401, 403, 422, 429].includes(result.httpStatus) ? "FAILED" : "UNKNOWN", error: "SUBMISSION_REJECTED" };
      }
      if (!validId(result.value.id)) return { state: "UNKNOWN", error: "SUBMISSION_UNCONFIRMED" };
      return { state: "QUEUED", upstreamId: result.value.id };
    },
    async check(id, credentials) {
      const result = await json(endpoint("check", id), credentials);
      if (result.httpStatus === 404 || result.httpStatus === 410) return { state: "FAILED", error: "PROVIDER_JOB_EXPIRED" };
      if (result.httpStatus) throw new Error("STATUS_UNAVAILABLE");
      const value = result.value;
      if (typeof value.done !== "boolean" || typeof value.faulted !== "boolean") throw new Error("INVALID_PROVIDER_STATUS");
      const progress = {};
      for (const [key, output] of [["queue_position", "queuePosition"], ["wait_time", "waitSeconds"], ["processing", "processing"]]) {
        if (Number.isFinite(value[key]) && value[key] >= 0) progress[output] = value[key];
      }
      return {
        state: value.faulted ? "FAILED" : value.done ? "SUCCEEDED" : value.processing > 0 ? "RUNNING" : "QUEUED",
        ...(value.faulted ? { error: "PROVIDER_JOB_FAILED" } : {}), progress,
      };
    },
    async result(id, credentials) {
      const result = await json(endpoint("status", id), credentials);
      if (result.httpStatus) throw new Error("RESULT_UNAVAILABLE");
      const value = result.value;
      const generation = value.generations?.[0];
      if (value.done !== true || value.faulted || value.generations?.length !== 1 || generation?.censored) throw new Error("RESULT_NOT_READY");
      const url = new URL(generation.img);
      if (url.protocol !== "https:" || !HORDE_IMAGE_HOSTS.has(url.hostname) || url.port || url.username || url.password) throw new Error("UNSAFE_RESULT_URL");
      const response = await fetchFn(url.href, { redirect: "error", signal: AbortSignal.timeout(HORDE_HTTP_TIMEOUT_MS) });
      if (!response.ok) {
        await response.body?.cancel();
        throw new Error("RESULT_UNAVAILABLE");
      }
      const contentType = (response.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
      if (!["image/png", "image/jpeg", "image/webp"].includes(contentType)) {
        await response.body?.cancel();
        throw new Error("INVALID_IMAGE_TYPE");
      }
      const bytes = await readBoundedBody(response, HORDE_MAX_IMAGE_BYTES);
      const signature = bytes.subarray(0, 12);
      const valid = contentType === "image/png" ? signature.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
        : contentType === "image/jpeg" ? signature[0] === 255 && signature[1] === 216 && signature[2] === 255
          : signature.subarray(0, 4).toString() === "RIFF" && signature.subarray(8, 12).toString() === "WEBP";
      if (!valid) throw new Error("INVALID_IMAGE_BYTES");
      return { bytes, contentType };
    },
  };
}
