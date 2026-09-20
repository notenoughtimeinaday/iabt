import { randomUUID } from "node:crypto";
import { runClaimedJob } from "./job-runner.js";

export const createJobWorker = ({
  repository,
  storage,
  providers,
  config,
  workerId = "iabt-worker-" + randomUUID()
}) => {
  let timer = null;
  let inFlight = null;
  let draining = null;
  let stopping = false;

  const executeOnce = async () => {
    const job = await repository.claimNextJob({
      workerId,
      leaseMs: config.worker.leaseMs
    });
    if (!job) return null;
    let leaseError = null;
    let renewal = null;
    const renew = () => {
      if (leaseError) return Promise.reject(leaseError);
      if (renewal) return renewal;
      renewal = (async () => {
        try {
          const owned = await repository.renewJobLease({ jobId: job.id, workerId });
          if (!owned) throw new Error("Lease ownership changed");
        } catch {
          // Database failure makes ownership uncertain too. Do not store or
          // finalize under a lease that can no longer be confirmed.
          leaseError = Object.assign(new Error("Job lease ownership could not be confirmed"), {
            code: "job_lease_lost"
          });
          throw leaseError;
        } finally {
          renewal = null;
        }
      })();
      return renewal;
    };
    const heartbeat = setInterval(() => {
      void renew().catch(() => {});
    }, Math.max(10, Math.floor(config.worker.leaseMs / 3)));
    try {
      return await runClaimedJob({
        job,
        workerId,
        repository,
        storage,
        providers,
        config,
        assertLease: renew,
        pollDelayMs: config.environment === "test"
          ? 0
          : Math.max(5000, Math.min(15000, config.worker.pollMs * 3))
      });
    } finally {
      clearInterval(heartbeat);
      // Shutdown must also drain a renewal already waiting on the database.
      if (renewal) await renewal.catch(() => {});
    }
  };

  const runOnce = () => {
    if (stopping) return Promise.resolve(null);
    if (!inFlight) {
      inFlight = executeOnce().finally(() => { inFlight = null; });
    }
    return inFlight;
  };

  const tick = () => {
    if (draining || stopping) return;
    draining = (async () => {
      try {
        while (!stopping && await runOnce()) {
          // Drain the ready queue before waiting for the next poll.
        }
      } catch (error) {
        console.error({ code: "worker_tick_failed", error_code: error?.code || "worker_error" });
      } finally {
        draining = null;
      }
    })();
  };

  return {
    workerId,
    runOnce,
    start() {
      if (timer || stopping) return;
      timer = setInterval(tick, config.worker.pollMs);
      tick();
    },
    async stop() {
      stopping = true;
      if (timer) clearInterval(timer);
      timer = null;
      // Finish the claimed job while its lease heartbeat is still active. No
      // later job can be claimed after stopping has been requested.
      await Promise.allSettled([inFlight, draining].filter(Boolean));
    }
  };
};
