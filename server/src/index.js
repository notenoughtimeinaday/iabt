import { createServer } from "node:http";
import { createIabtHandler } from "./app.js";
import { loadConfig } from "./config.js";
import { MemoryRepository } from "./memory-repository.js";

const config = loadConfig();
const repository = new MemoryRepository();
const server = createServer(createIabtHandler({ repository, config }));

server.listen(config.port, () => {
  console.log(
    `IABT standalone API listening on port ${config.port} (${config.environment})`
  );
});
