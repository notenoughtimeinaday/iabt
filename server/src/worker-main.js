import { createRuntime } from "./runtime.js";
import { createJobWorker } from "./worker.js";

const runtime = await createRuntime();
const worker = createJobWorker(runtime);
worker.start();

console.log(
  JSON.stringify({
    event: "iabt_worker_started",
    worker_id: worker.workerId,
    environment: runtime.config.environment
  })
);

let shuttingDown = false;
const shutdown = async (signal) => {
  if (shuttingDown) return;
  shuttingDown = true;
  worker.stop();
  await runtime.repository.close?.();
  console.log(JSON.stringify({ event: "iabt_worker_stopped", signal }));
  process.exit(0);
};

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
