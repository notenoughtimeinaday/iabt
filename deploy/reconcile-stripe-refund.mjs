import { loadConfig } from "../server/src/config.js";
import { PostgresRepository } from "../server/src/postgres-repository.js";
import { assertBillingBinding } from "../server/src/billing/environment.js";
import { reviewStripeRefund, approveStripeRefundReview } from "../server/src/billing/refund-reconciliation.js";

const [command, ...argumentsList] = process.argv.slice(2);
const options = {};
const names = new Set(["owner", "fulfillment", "event", "refund", "account", "review", "digest", "operator", "approve-policy"]);
let repository;
try {
  if (!["review", "approve"].includes(command) || argumentsList.length % 2) throw new Error("usage");
  for (let index = 0; index < argumentsList.length; index += 2) {
    const name = argumentsList[index].replace(/^--/, "");
    if (!argumentsList[index].startsWith("--") || !names.has(name) || options[name]) throw new Error("usage");
    options[name] = argumentsList[index + 1];
  }
  const required = command === "review" ? ["owner", "fulfillment", "event", "account"]
    : ["owner", "review", "digest", "operator", "approve-policy"];
  if (required.some((name) => !options[name])) throw new Error("usage");
  const config = loadConfig(process.env);
  if (!config.databaseUrl) throw new Error("database_required");
  repository = new PostgresRepository({ connectionString: config.databaseUrl });
  // Do not bootstrap or migrate an environment as a side effect of an operator
  // review. Runtime initialization must already have installed/bound this DB.
  const binding = await repository.pool.query("SELECT mode, bound_from, bound_at FROM iabt_billing_environment WHERE singleton = true");
  if (!binding.rows[0]) throw new Error("billing_binding_required");
  assertBillingBinding(binding.rows[0], config.providers.stripe.mode);
  const common = { repository, config, ownerId: options.owner };
  const result = command === "review"
    ? await reviewStripeRefund({ ...common, fulfillmentId: options.fulfillment, eventId: options.event,
      refundId: options.refund, expectedAccountId: options.account })
    : await approveStripeRefundReview({ ...common, reviewId: options.review, evidenceDigest: options.digest,
      operatorId: options.operator, approvePolicy: options["approve-policy"] });
  process.stdout.write(JSON.stringify(result, null, 2) + "\n");
} catch (error) {
  // Never echo raw driver/provider diagnostics or command arguments.
  process.stderr.write(JSON.stringify({ error: error.code || "refund_operator_command_failed",
    usage: "node deploy/reconcile-stripe-refund.mjs review --owner UUID --fulfillment UUID --event evt_ID --account acct_ID [--refund re_ID] | approve --owner UUID --review UUID --digest SHA256 --operator OPERATOR --approve-policy retain_existing_credits_v1" }) + "\n");
  process.exitCode = 1;
} finally {
  await repository?.close();
}
