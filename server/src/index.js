import { createServer } from "node:http";
import { createIabtHandler } from "./app.js";
import { createRuntime } from "./runtime.js";
import { createJobWorker } from "./worker.js";

const runtime = await createRuntime();
const { config, repository, storage, providers } = runtime;
const worker = createJobWorker(runtime);
const server = createServer(
  createIabtHandler({ repository, config, storage, providers })
);

server.listen(config.port, () => {
  console.log(
    JSON.stringify({
      event: "iabt_api_started",
      port: config.port,
      environment: config.environment,
      embedded_worker: config.worker.enabled
    })
  );
  if (config.worker.enabled) worker.start();
});

let shuttingDown = false;
const shutdown = async (signal) => {
  if (shuttingDown) return;
  shuttingDown = true;
  try {
    await Promise.all([
      worker.stop(),
      new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
    ]);
    await repository.close?.();
    console.log(JSON.stringify({ event: "iabt_api_stopped", signal }));
    process.exit(0);
  } catch {
    console.error(JSON.stringify({ event: "iabt_api_shutdown_failed", signal }));
    process.exit(1);
  }
};

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
