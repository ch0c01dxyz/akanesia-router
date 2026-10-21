import { getAdapter } from "@/lib/db/driver.js";
import { getProviderConnectionById, getProviderConnections, validateApiKey } from "@/lib/localDb.js";
import { getDisabledByProvider } from "@/lib/db/repos/disabledModelsRepo.js";
import { getProviderCredentials } from "../services/auth.js";
import { getKeyAccessContext, enforceKeyAccessResolved } from "../services/keyAccess.js";
import { createHordeJobRepository, createHordeImageJobHandler } from "../services/hordeImageJobs.js";
import { createHordeJobProvider } from "../../../open-sse/handlers/imageProviders/hordeJobs.js";
import horde from "../../../open-sse/providers/registry/aihorde.js";

export async function handleImageJob(request, options) {
  try {
    const repository = createHordeJobRepository(await getAdapter());
    const handler = createHordeImageJobHandler({
      repository,
      authenticate: validateApiKey,
      async authorize(req, model) {
        const denied = await enforceKeyAccessResolved(await getKeyAccessContext(req), model, "aihorde", model.slice(8));
        if (denied) return denied;
        const name = model.slice(8);
        const disabled = await getDisabledByProvider("aihorde");
        const connections = await getProviderConnections({ provider: "aihorde", isActive: true });
        const imageModel = horde.models.some((entry) => entry.id === name && entry.kind === "image");
        const enabledConnection = connections.some((connection) => {
          const enabled = connection.providerSpecificData?.enabledModels;
          return !Array.isArray(enabled) || !enabled.length || enabled.includes(name);
        });
        if (!imageModel || disabled.includes(name) || disabled.includes(model) || !enabledConnection) {
          return Response.json({ error: { code: "MODEL_UNAVAILABLE" } }, { status: 403, headers: { "Cache-Control": "no-store" } });
        }
        return null;
      },
      async selectConnection(model) {
        const connections = await getProviderConnections({ provider: "aihorde", isActive: true });
        const excluded = new Set(connections.filter((connection) => {
          const enabled = connection.providerSpecificData?.enabledModels;
          return Array.isArray(enabled) && enabled.length && !enabled.includes(model);
        }).map((connection) => connection.id));
        const credentials = await getProviderCredentials("aihorde", excluded, model);
        if (!credentials?.connectionId) return null;
        const connection = await getProviderConnectionById(credentials.connectionId);
        const enabled = connection?.providerSpecificData?.enabledModels;
        return Array.isArray(enabled) && enabled.length && !enabled.includes(model) ? null : credentials;
      },
      async getConnection(id, model) {
        const connection = await getProviderConnectionById(id);
        const enabled = connection?.providerSpecificData?.enabledModels;
        return connection?.isActive && connection.provider === "aihorde" && (!Array.isArray(enabled) || !enabled.length || enabled.includes(model)) ? connection : null;
      },
      provider: createHordeJobProvider(),
    });
    return await handler(request, options);
  } catch {
    return Response.json({ error: { code: "IMAGE_JOB_UNAVAILABLE" } }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
