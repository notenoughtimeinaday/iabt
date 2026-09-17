import { getAppLocation, safeAppPath } from "./routing.js";

// Return a router-relative, same-origin destination in either routing mode.
// Session/bootstrap parameters are removed by the shared path validator.
export function safeReturnTo(location = window.location) {
  const raw = getAppLocation(location).searchParams.get("returnTo");
  return safeAppPath(raw, { origin: location.origin });
}
