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
const shutdown = (signal) => {
  if (shuttingDown) return;
  shuttingDown = true;
  worker.stop();
  server.close(async () => {
    await repository.close?.();
    console.log(JSON.stringify({ event: "iabt_api_stopped", signal }));
    process.exit(0);
  });
};

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
