import { createServer } from "node:http";
import { createIabtHandler } from "./app.js";
import { loadConfig } from "./config.js";
import { createProviderRegistry } from "./providers/provider-registry.js";
import { createRepository } from "./repository-factory.js";
import { createObjectStorage } from "./storage/storage-factory.js";
import { createJobWorker } from "./worker.js";

const config = loadConfig();
const repository = await createRepository(config);
const storage = await createObjectStorage(config);
const providers = createProviderRegistry(config);
const worker = createJobWorker({ repository, storage, providers, config });
const server = createServer(
  createIabtHandler({ repository, config, storage, providers })
);

server.listen(config.port, () => {
  console.log(
    `IABT standalone API listening on port ${config.port} (${config.environment})`
  );
  if (config.worker.enabled) worker.start();
});

const shutdown = async () => {
  worker.stop();
  server.close(async () => {
    await repository.close?.();
    process.exit(0);
  });
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
