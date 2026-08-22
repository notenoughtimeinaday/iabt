import { createClientFromRequest } from "npm:@base44/sdk";
import { requireUser } from "../../shared/creation.ts";
import {
  connectionFabricResponse,
  mergeConnectionAdapters,
} from "../../shared/connection-fabric.ts";

Deno.serve(async (req) => {
  try {
    if (req.method !== "POST") {
      return Response.json({ error: "Method not allowed." }, { status: 405 });
    }

    const base44 = createClientFromRequest(req);
    await requireUser(base44);
    const body = await req.json().catch(() => ({}));
    const intent = String(body?.intent || "").trim().slice(0, 80);
    const requestedSystem = String(body?.requested_system || body?.system || "").trim().slice(0, 500);

    const stored = await base44.asServiceRole.entities.ConnectionAdapter
      .filter({ enabled: true }, "priority", 100)
      .catch(() => []);

    return Response.json({
      ok: true,
      fabric: connectionFabricResponse(
        mergeConnectionAdapters(Array.isArray(stored) ? stored : []),
        intent,
        requestedSystem,
      ),
      discovery_only: true,
      charged: false,
      note: "This readiness check does not create a connection, expose credentials, approve cost, or execute an external action.",
    });
  } catch (error) {
    if (error instanceof Response) return error;
    const message = error instanceof Error ? error.message : String(error);
    return Response.json({ error: message }, { status: 500 });
  }
});
