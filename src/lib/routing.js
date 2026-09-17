// Browser routing remains the default. Hash mode works on static hosts without
// server-side SPA rewrites because only '/' is requested when a link is opened.
export const routingMode = import.meta.env?.VITE_IABT_ROUTING || "browser";

const bootstrapParameters = ["access_token", "clear_access_token", "app_id", "app_base_url", "functions_version", "from_url"];
const currentOrigin = () => typeof window === "undefined" ? "http://localhost" : window.location.origin;

export function safeAppPath(value, { origin = currentOrigin(), mode = routingMode } = {}) {
  if (!value || /[\\\u0000-\u001f\u007f]/.test(String(value))) return "/";
  try {
    let url = new URL(String(value), origin);
    if (url.origin !== origin) return "/";
    if (mode === "hash" && url.hash.startsWith("#/")) {
      url = new URL(url.hash.slice(1), origin);
      if (url.origin !== origin) return "/";
    }
    for (const name of bootstrapParameters) url.searchParams.delete(name);
    const path = url.pathname + url.search + url.hash;
    if (!path.startsWith("/") || path.startsWith("//") || path.includes("\\")) return "/";
    return path;
  } catch {
    return "/";
  }
}

export function appHref(path = "/", options = {}) {
  const mode = options.mode || routingMode;
  const route = safeAppPath(path, { ...options, mode });
  return mode === "hash" ? "/#" + route : route;
}

export function getAppLocation(location = window.location, { mode = routingMode } = {}) {
  const value = mode === "hash" && location.hash?.startsWith("#/")
    ? location.hash.slice(1)
    : (location.pathname || "/") + (location.search || "") + (location.hash || "");
  return new URL(safeAppPath(value, { origin: location.origin, mode }), location.origin);
}

export function normalizeRoutingLocation(browser = window, mode = routingMode) {
  if (mode !== "hash") return;
  const current = new URL(browser.location.href);
  const route = getAppLocation(current, { mode });
  // External services such as Stripe return to '/?billing=...'. Preserve those
  // parameters inside the route before the router or auth guard reads them.
  for (const [name, value] of current.searchParams) {
    if (!route.searchParams.has(name)) route.searchParams.append(name, value);
  }
  const target = appHref(route.pathname + route.search + route.hash, { origin: current.origin, mode });
  if (current.pathname + current.search + current.hash !== target) {
    browser.history.replaceState(browser.history.state, "", target);
  }
}
