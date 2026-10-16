import { PLAN_DEFAULTS, planDefaults } from "./plans.js";

// Creation through the public API must share the record transaction used by
// entitlement updates. Counting in the client, or before acquiring this lock,
// allows parallel requests on different API instances to exceed the plan.
// Migration/import tooling intentionally retains its direct repository path.
export async function createProjectsWithinQuota({ repository, user, inputs, bulk = false }) {
  const owner = { ...user, role: "user" };
  return repository.withRecordTransaction(async (tx) => {
    const [entitlement] = await tx.listRecordsExact("AccountEntitlement", owner, {
      query: { user_id: owner.id }, sort: "-updated_date", limit: 1
    });
    // Match the subscription webhook's grace policy. Unknown or inactive
    // subscriptions receive free capacity; arbitrary stored numeric fields
    // cannot make a limited plan unlimited.
    const candidate = entitlement?.plan;
    const plan = typeof candidate === "string" && Object.hasOwn(PLAN_DEFAULTS, candidate) &&
      ["active", "trialing", "past_due"].includes(entitlement?.status) ? candidate : "free";
    const limit = planDefaults(plan).project_limit;
    if (limit > 0 && inputs.length > 0) {
      // We need only know whether capacity is exhausted. Fetch at most the
      // small canonical plan limit, so pagination cannot hide excess records.
      const existing = await tx.listRecordsExact("Project", owner, { limit });
      if (existing.length + inputs.length > limit) {
        throw Object.assign(new Error(`Your current plan allows ${limit} cloud project${limit === 1 ? "" : "s"}. Choose a larger plan or remove a project before creating another.`), {
          status: 403, code: "project_limit_reached"
        });
      }
    }
    const records = [];
    for (const input of inputs) records.push(await tx.createRecord("Project", owner, input));
    await tx.appendAudit(owner, bulk ? "entity.bulk_create" : "entity.create", {
      entity_name: "Project", ...(bulk ? { count: records.length } : { record_id: records[0].id })
    });
    return records;
  });
}
