import { createServer } from "node:http";
import { createIabtHandler } from "./app.js";
import { loadConfig } from "./config.js";
import { createRepository } from "./repository-factory.js";

const config = loadConfig();
const repository = await createRepository(config);
const server = createServer(createIabtHandler({ repository, config }));

server.listen(config.port, () => {
  console.log(
    `IABT standalone API listening on port ${config.port} (${config.environment})`
  );
});

const shutdown = async () => {
  server.close(async () => {
    await repository.close?.();
    process.exit(0);
  });
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
