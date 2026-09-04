import { loadConfig } from "./config.js";
import { createProviderRegistry } from "./providers/provider-registry.js";
import { createRepository } from "./repository-factory.js";
import { createObjectStorage } from "./storage/storage-factory.js";

export const createRuntime = async ({ config = loadConfig() } = {}) => {
  const repository = await createRepository(config);
  try {
    const storage = await createObjectStorage(config);
    const providers = createProviderRegistry(config);
    return { config, repository, storage, providers };
  } catch (error) {
    await repository.close?.();
    throw error;
  }
};
