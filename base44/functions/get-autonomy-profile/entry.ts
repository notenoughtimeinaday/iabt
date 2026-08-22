import { createClientFromRequest } from "npm:@base44/sdk";
import { requireUser } from "../../shared/creation.ts";
import {
  autonomySummary,
  publicAutonomyPolicy,
  publicRunbook,
} from "../../shared/autonomy.ts";

Deno.serve(async (req) => {
  try {
    if (req.method !== "POST") {
      return Response.json({ error: "Method not allowed." }, { status: 405 });
    }

    const base44 = createClientFromRequest(req);
    const user = await requireUser(base44);

    const [policies, rows] = await Promise.all([
      base44.asServiceRole.entities.AutonomyPolicy
        .filter({ user_id: user.id }, "-updated_date", 5)
        .catch(() => []),
      base44.asServiceRole.entities.AutomationRunbook
        .filter({ user_id: user.id }, "-updated_date", 100)
        .catch(() => []),
    ]);

    const policy = publicAutonomyPolicy(Array.isArray(policies) ? policies[0] : null, user);
    const runbooks = (Array.isArray(rows) ? rows : []).map(publicRunbook);

    return Response.json({
      ok: true,
      policy,
      runbooks,
      autonomy: autonomySummary(policy, runbooks),
      read_only: true,
      note: "This check does not connect a service, widen permissions, store credentials, approve cost, or execute a runbook.",
    });
  } catch (error) {
    if (error instanceof Response) return error;
    const message = error instanceof Error ? error.message : String(error);
    return Response.json({ error: message }, { status: 500 });
  }
});
