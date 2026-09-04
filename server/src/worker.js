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
  let active = false;

  const runOnce = async () => {
    const job = await repository.claimNextJob({
      workerId,
      leaseMs: config.worker.leaseMs
    });
    if (!job) return null;
    return runClaimedJob({ job, workerId, repository, storage, providers });
  };

  const tick = async () => {
    if (active) return;
    active = true;
    try {
      while (await runOnce()) {
        // Drain the ready queue before waiting for the next poll.
      }
    } catch (error) {
      console.error({ code: "worker_tick_failed", message: error.message });
    } finally {
      active = false;
    }
  };

  return {
    workerId,
    runOnce,
    start() {
      if (timer) return;
      timer = setInterval(tick, config.worker.pollMs);
      timer.unref?.();
      void tick();
    },
    stop() {
      if (timer) clearInterval(timer);
      timer = null;
    }
  };
};