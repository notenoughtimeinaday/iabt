import { base44 as legacyClient, getBase44PublicSettings } from "../api/base44Client";

export const platformRuntime = Object.freeze({
  backend: "base44",
  portable: true,
  apiUrl: "",
});

export const iabtClient = legacyClient;
export const base44 = iabtClient;
export const getPublicSettings = getBase44PublicSettings;
