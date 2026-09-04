import { MemoryRepository } from "./memory-repository.js";

export const createRepository = async (config) => {
  if (config.databaseUrl) {
    const { PostgresRepository } = await import("./postgres-repository.js");
    const repository = new PostgresRepository({
      connectionString: config.databaseUrl
    });
    await repository.ready();
    return repository;
  }

  if (config.environment === "production") {
    throw new Error(
      "IABT_DATABASE_URL is required in production; in-memory storage is forbidden"
    );
  }

  return new MemoryRepository();
};
