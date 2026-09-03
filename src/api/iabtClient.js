import { base44 as base44Client, getBase44PublicSettings } from "./base44Client";
import { standaloneClient, getStandalonePublicSettings } from "./standaloneClient";

const configuredBackend = String(import.meta.env.VITE_IABT_BACKEND || "base44")
  .trim()
  .toLowerCase();

if (!["base44", "standalone"].includes(configuredBackend)) {
  throw new Error(`Unsupported VITE_IABT_BACKEND: ${configuredBackend}`);
}

export const platformRuntime = Object.freeze({
  backend: configuredBackend,
  portable: true,
  apiUrl:
    configuredBackend === "standalone"
      ? String(import.meta.env.VITE_IABT_API_URL || "")
      : "",
});

export const iabtClient =
  configuredBackend === "standalone" ? standaloneClient : base44Client;

// Temporary compatibility name. Feature code imports this IABT-owned boundary;
// the Base44 adapter can be removed after the standalone API migration.
export const base44 = iabtClient;

export const getPublicSettings =
  configuredBackend === "standalone"
    ? getStandalonePublicSettings
    : getBase44PublicSettings;
