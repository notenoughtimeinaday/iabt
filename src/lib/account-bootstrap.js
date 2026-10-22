const unavailable = () => ({
  type: "service_unavailable",
  message: "Jericho could not connect to your workspace. Please try again in a moment.",
});

export function accountAccessError(error) {
  const reason = error?.data?.extra_data?.reason;
  if (error?.status === 403 && reason === "user_not_registered") {
    return { type: "user_not_registered", message: "User not registered for this app" };
  }
  if (error?.status === 401 || (error?.status === 403 && (!reason || reason === "auth_required"))) {
    return { type: "auth_required", message: "Authentication required" };
  }
  return unavailable();
}

// Resolve startup atomically. Outages must not masquerade as a bad password,
// discard a session, or leave a protected route waiting for unchecked auth.
export async function loadAccountState({ getPublicSettings, getUser, authOnly = false }) {
  let settings = null;
  try {
    if (!authOnly) settings = await getPublicSettings();
    const user = authOnly || settings?.authenticated || settings?.has_session ? await getUser() : null;
    return { user, isAuthenticated: Boolean(user), authError: null, appPublicSettings: settings };
  } catch (error) {
    return { user: null, isAuthenticated: false, authError: accountAccessError(error), appPublicSettings: settings };
  }
}
