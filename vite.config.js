import { fileURLToPath } from "node:url";
import { defineConfig, loadEnv } from "vite";
import { createFrontendConfig } from "./scripts/frontend-config.mjs";

const root = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig(({ mode }) =>
  createFrontendConfig({ root, env: loadEnv(mode, root, "") }),
);
