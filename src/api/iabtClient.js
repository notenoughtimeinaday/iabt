import { standaloneClient, getStandalonePublicSettings } from "./standaloneClient";

// No legacy imports: Vite selects a separate entry for explicit Base44 builds.
export const platformRuntime = Object.freeze({
  backend: "standalone",
  portable: true,
  apiUrl: import.meta.env.VITE_IABT_API_URL,
});

export const iabtClient = standaloneClient;
export const getPublicSettings = getStandalonePublicSettings;

// Compatibility export for existing feature code; this is the IABT API client.
export const base44 = iabtClient;
