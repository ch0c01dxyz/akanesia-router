import { handleSystemone } from "@/sse/handlers/systemone.js";
import { buildModelsList } from "../models/route.js";
import { getKeyAccessContext, filterModelsListForKey } from "@/sse/services/keyAccess.js";

/**
 * Handle CORS preflight
 */
export async function OPTIONS() {
  return new Response(null, {
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "*"
    }
  });
}

/**
 * GET /v1/systemone - List decisions-capable (System One) models.
 * Same catalog as GET /v1/models/systemone.
 */
export async function GET(request) {
  try {
    const keyAccess = await getKeyAccessContext(request);
    const data = await filterModelsListForKey(keyAccess, await buildModelsList(["systemone"]));
    return Response.json({ object: "list", data }, {
      headers: { "Access-Control-Allow-Origin": "*" },
    });
  } catch (error) {
    console.log("Error fetching decisions models:", error);
    return Response.json(
      { error: { message: error.message, type: "server_error" } },
      { status: 500 }
    );
  }
}

/**
 * POST /v1/systemone - System One (Jev) decision endpoint
 */
export async function POST(request) {
  return await handleSystemone(request);
}
