import path from "node:path";
import react from "@vitejs/plugin-react";

const legacyModule = /(?:\/node_modules\/@base44\/|\/src\/legacy\/|\/src\/api\/base44Client\.js|\/src\/lib\/app-params\.js)/;
const legacyRuntime = /(?:\/api\/app-logs\/|\/api\/apps\/|base44_access_token|base44-sdk|base44\.app)/i;

export const standaloneBoundary = () => ({
  name: "iabt-standalone-boundary",
  enforce: "pre",
  transform(_code, id) {
    if (legacyModule.test(id.replaceAll("\\", "/"))) {
      this.error(`Standalone frontend cannot load a Base44 module: ${id}`);
    }
  },
  generateBundle(_options, bundle) {
    for (const item of Object.values(bundle)) {
      if (!/\.(?:html|js)$/.test(item.fileName)) continue;
      const text = item.type === "chunk" ? item.code : String(item.source);
      if (legacyRuntime.test(text)) {
        this.error(`Base44 runtime code found in standalone output: ${item.fileName}`);
      }
    }
  },
});

export const createFrontendConfig = async ({ root, env }) => {
  const backend = String(env.VITE_IABT_BACKEND || "standalone").trim().toLowerCase();
  if (!["standalone", "base44"].includes(backend)) {
    throw new Error(`Unsupported VITE_IABT_BACKEND: ${backend}`);
  }

  const aliases = [];
  const plugins = [react()];
  let apiUrl = "";
  if (backend === "standalone") {
    try {
      const url = new URL(String(env.VITE_IABT_API_URL || "").trim());
      if (!["http:", "https:"].includes(url.protocol) || url.username || url.password ||
          url.search || url.hash || url.pathname !== "/" ||
          /(^|\.)base44\.(app|com)$/i.test(url.hostname)) {
        throw new Error("invalid origin");
      }
      apiUrl = url.origin;
    } catch {
      throw new Error("VITE_IABT_API_URL must be an absolute HTTP(S) origin for the independent IABT API (no credentials, path, query, or fragment)");
    }
    plugins.push(standaloneBoundary());
  } else {
    // Load platform tooling only for the temporary, explicit legacy build.
    const { default: base44 } = await import("@base44/vite-plugin");
    plugins.push(base44({
      legacySDKImports: env.BASE44_LEGACY_SDK_IMPORTS === "true",
      hmrNotifier: true,
      navigationNotifier: true,
      analyticsTracker: true,
      visualEditAgent: true,
    }));
    aliases.push(
      { find: /^@\/api\/iabtClient(?:\.js)?$/, replacement: path.join(root, "src/legacy/iabtClient.js") },
      { find: /^@\/pages\/OAuthConsent(?:\.jsx)?$/, replacement: path.join(root, "src/legacy/OAuthConsent.jsx") },
    );
    // The legacy plugin adds its own broad @/ alias in a config hook. Apply
    // these exact entries afterward so that alias cannot bypass the boundary.
    plugins.push({
      name: "iabt-legacy-entries",
      enforce: "post",
      config: () => ({ resolve: { alias: aliases } }),
    });
  }
  aliases.push({ find: "@", replacement: path.join(root, "src") });

  return {
    root,
    plugins,
    resolve: { alias: aliases },
    define: {
      "import.meta.env.VITE_IABT_BACKEND": JSON.stringify(backend),
      "import.meta.env.VITE_IABT_API_URL": JSON.stringify(apiUrl),
    },
  };
};
