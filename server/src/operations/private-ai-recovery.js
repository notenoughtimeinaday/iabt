import { randomUUID } from "node:crypto";
import { PostgresRepository } from "../postgres-repository.js";
import { assertPrivateAcceptanceAccess, assertPrivateAcceptanceJob } from "../autonomy/private-acceptance.js";

const denied = () => Object.assign(new Error("Unsubmitted recovery is not authorized"), { code: "ai_acceptance_not_authorized" });

// Operator-only library: no HTTP route or model tool exposes this operation.
// Queue admission, reservation and plan projection commit together so a worker
// cannot claim the replacement before its exact job identity is durable.
export async function recoverUnsubmittedAuthorizationFailure({ repository, config, user, previousJobId, operatorApproved = false }) {
  if (!operatorApproved || !user?.email_verified || !config.orchestration?.privateAcceptance?.enabled) throw denied();
  return repository.withTransaction(async client => {
    const tx = new PostgresRepository({ pool: client });
    await client.query("SELECT id FROM iabt_jobs WHERE id=$1 AND owner_id=$2 FOR UPDATE", [previousJobId, user.id]);
    const previous = await tx.getJob(previousJobId, { ...user, role: "user" });
    if (!previous) throw denied();
    const planId = previous.input.plan_id;
    assertPrivateAcceptanceAccess(config, user, planId);
    const key = previous.idempotency_key + ":recover:" + previous.id;
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", ["job:" + user.id + ":" + key]);
    const existing = await client.query("SELECT id FROM iabt_jobs WHERE owner_id=$1 AND idempotency_key=$2", [user.id, key]);
    if (existing.rowCount) return tx.getJob(existing.rows[0].id, { ...user, role: "user" });
    await client.query("SELECT id FROM iabt_entity_records WHERE entity_name='CreationPlan' AND id=$1 AND owner_id=$2 FOR UPDATE", [planId, user.id]);
    const plan = await tx.getRecord("CreationPlan", planId, { ...user, role: "user" });
    if (!plan || plan.execution_job_id !== previous.id || plan.status !== "failed") throw denied();
    const credits = previous.credit_amount;
    if (!Number.isSafeInteger(credits) || credits <= 0) throw denied();
    const reserved = await client.query("UPDATE iabt_credit_accounts SET available_credits=available_credits-$2,reserved_credits=reserved_credits+$2,updated_at=now() WHERE owner_id=$1 AND available_credits >= $2 RETURNING owner_id", [user.id, credits]);
    if (!reserved.rowCount) throw Object.assign(new Error("Insufficient IABT credits"), { code: "insufficient_credits" });
    const id = randomUUID();
    await client.query("INSERT INTO iabt_jobs(id,owner_id,job_type,status,input,approval,idempotency_key,credit_amount,max_attempts) VALUES($1,$2,$3,'queued',$4::jsonb,$5::jsonb,$6,$7,$8)",
      [id, user.id, previous.job_type, JSON.stringify({ ...previous.input, authorization_recovery_from_job_id: previous.id }), JSON.stringify(previous.approval), key, credits, previous.max_attempts]);
    await client.query("INSERT INTO iabt_credit_entries(id,owner_id,job_id,entry_type,amount,idempotency_key,metadata) VALUES($1,$2,$3,'reserve',$4,$5,$6::jsonb)",
      [randomUUID(), user.id, id, credits, key, JSON.stringify({ source: "operator_unsubmitted_authorization_recovery", previous_job_id: previous.id, plan_id: planId })]);
    await tx.updateRecord("CreationPlan", planId, { ...user, role: "user" }, { status: "executing", execution_job_id: id });
    const job = await tx.getJob(id, { ...user, role: "user" });
    await assertPrivateAcceptanceJob({ config, user, job, repository: tx });
    return job;
  });
}
