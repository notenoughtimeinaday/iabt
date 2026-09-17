import { appHref, safeAppPath } from "../lib/routing.js";

const trimSlash = (value) => String(value || "").replace(/\/+$/, "");
const apiUrl = trimSlash(import.meta.env.VITE_IABT_API_URL);

const storage = (() => {
  try { return typeof window === "undefined" ? null : window.localStorage; }
  catch { return null; }
})();

// Standalone has no OAuth token callback. URL tokens must never select a user's session.
let accessToken = (() => {
  try { return storage?.getItem("iabt_access_token") || null; }
  catch { return null; }
})();

const requireApiUrl = () => {
  if (!apiUrl) {
    throw new Error(
      "VITE_IABT_API_URL is required when VITE_IABT_BACKEND=standalone",
    );
  }
};

const request = async (path, options = {}) => {
  requireApiUrl();
  const headers = new Headers(options.headers || {});
  if (!headers.has("Content-Type") && options.body && !(options.body instanceof FormData)) {
    headers.set("Content-Type", "application/json");
  }
  if (options.auth !== false && accessToken) {
    headers.set("Authorization", `Bearer ${accessToken}`);
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.body instanceof FormData ? 120000 : 30000);
  const requestToken = accessToken;
  try {
    const response = await fetch(`${apiUrl}${path}`, {
      method: options.method || "GET",
      headers,
      signal: controller.signal,
      body:
        options.body instanceof FormData || typeof options.body === "string"
          ? options.body
          : options.body
            ? JSON.stringify(options.body)
            : undefined,
    });

    const text = await response.text();
    let payload = null;
    try { payload = text ? JSON.parse(text) : null; }
    catch {
      // A gateway may return an HTML error page. Never expose that page as an API error.
      if (response.ok) throw Object.assign(new Error("IABT returned an unexpected response. Please try again."), { code: "invalid_response" });
    }
    if (!response.ok) {
      const error = new Error(typeof payload?.message === "string" ? payload.message : `IABT API request failed (${response.status}). Please try again.`);
      error.status = response.status;
      error.data = payload;
      if (response.status === 401 && options.auth !== false && accessToken === requestToken) setToken(null);
      throw error;
    }
    return payload;
  } catch (error) {
    if (controller.signal.aborted) {
      throw Object.assign(new Error("The request timed out. Check its status before trying again."), { code: "request_timeout" });
    }
    if (error instanceof TypeError) {
      throw Object.assign(new Error("Could not reach IABT. Check your connection and try again."), { code: "network_unavailable" });
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
};

const specialCollection = async (name) => {
  if (name === "GenerationJob") return request("/v1/jobs");
  if (name === "CreationArtifact") return request("/v1/artifacts");
  return null;
};

const sortAndPage = (records, sort, limit, skip) => {
  const descending = String(sort || "").startsWith("-");
  const field = String(sort || "created_date").replace(/^-/, "");
  return [...records]
    .sort((left, right) => {
      const a = left[field] ?? "";
      const b = right[field] ?? "";
      return (a === b ? 0 : a > b ? 1 : -1) * (descending ? -1 : 1);
    })
    .slice(skip, skip + limit);
};

const entity = (name) => {
  const special = name === "GenerationJob" || name === "CreationArtifact";
  return {
    list: async (sort = "-created_date", limit = 50, skip = 0) => {
      if (special) return sortAndPage(await specialCollection(name), sort, limit, skip);
      return request(`/v1/entities/${encodeURIComponent(name)}/list`, {
        method: "POST",
        body: { sort, limit, skip },
      });
    },
    filter: async (query = {}, sort = "-created_date", limit = 50, skip = 0) => {
      if (special) {
        const records = await specialCollection(name);
        const filtered = records.filter((record) =>
          Object.entries(query).every(([key, value]) => record[key] === value),
        );
        return sortAndPage(filtered, sort, limit, skip);
      }
      return request(`/v1/entities/${encodeURIComponent(name)}/filter`, {
        method: "POST",
        body: { query, sort, limit, skip },
      });
    },
    get: (id) =>
      special
        ? specialCollection(name).then((records) =>
            records.find((record) => record.id === id) || null,
          )
        : request(`/v1/entities/${encodeURIComponent(name)}/${encodeURIComponent(id)}`),
    create: (record) =>
      request(`/v1/entities/${encodeURIComponent(name)}`, {
        method: "POST",
        body: record,
      }),
    update: (id, record) =>
      request(`/v1/entities/${encodeURIComponent(name)}/${encodeURIComponent(id)}`, {
        method: "PATCH",
        body: record,
      }),
    delete: (id) =>
      request(`/v1/entities/${encodeURIComponent(name)}/${encodeURIComponent(id)}`, {
        method: "DELETE",
      }),
    deleteMany: (query) =>
      request(`/v1/entities/${encodeURIComponent(name)}/delete-many`, {
        method: "POST",
        body: { query },
      }),
    bulkCreate: (records) =>
      request(`/v1/entities/${encodeURIComponent(name)}/bulk`, {
        method: "POST",
        body: { records },
      }),
    subscribe: () => () => {},
  };
};

const entities = new Proxy(
  {},
  {
    get: (_target, name) => entity(String(name)),
  },
);

const setToken = (token) => {
  accessToken = token || null;
  if (!storage) return;
  try {
    if (accessToken) storage.setItem("iabt_access_token", accessToken);
    else storage.removeItem("iabt_access_token");
  } catch {
    // Private browsing/storage restrictions still allow a session in this tab.
  }
};

const oauthRedirect = (provider, returnTo) => {
  requireApiUrl();
  const target = new URL(`${apiUrl}/v1/auth/oauth/${encodeURIComponent(provider)}`);
  target.searchParams.set("return_to", returnTo || window.location.href);
  window.location.assign(target.toString());
};

const conversationSubscriptions = new Map();

export const standaloneClient = {
  auth: {
    me: () => request("/v1/auth/me"),
    loginViaEmailPassword: async (email, password) => {
      const result = await request("/v1/auth/login", {
        method: "POST",
        auth: false,
        body: { email, password },
      });
      setToken(result?.access_token);
      return result;
    },
    register: (input) =>
      request("/v1/auth/register", { method: "POST", auth: false, body: input }),
    verifyOtp: async (input) => {
      const result = await request("/v1/auth/verify-otp", {
        method: "POST",
        auth: false,
        body: input,
      });
      setToken(result?.access_token);
      return result;
    },
    resendOtp: (email) =>
      request("/v1/auth/resend-otp", { method: "POST", auth: false, body: { email } }),
    resetPasswordRequest: (email) =>
      request("/v1/auth/reset-request", { method: "POST", auth: false, body: { email } }),
    resetPassword: (input) =>
      request("/v1/auth/reset", { method: "POST", auth: false, body: input }),
    loginWithProvider: oauthRedirect,
    logout: async (returnTo) => {
      try {
        if (accessToken) await request("/v1/auth/logout", { method: "POST" });
      } finally {
        setToken(null);
        if (returnTo && typeof window !== "undefined") window.location.assign(appHref(returnTo));
      }
    },
    redirectToLogin: (returnTo) => {
      if (typeof window === "undefined") return;
      const url = new URL("/login", window.location.origin);
      if (returnTo) url.searchParams.set("returnTo", safeAppPath(returnTo));
      window.location.assign(appHref(url.pathname + url.search));
    },
    setToken,
  },
  entities,
  functions: {
    invoke: (name, args = {}) =>
      request(`/v1/functions/${encodeURIComponent(name)}`, {
        method: "POST",
        body: args,
      }),
  },
  jobs: {
    list: () => request("/v1/jobs"),
    get: (id) => request(`/v1/jobs/${encodeURIComponent(id)}`),
  },
  providers: {
    readiness: () => request("/v1/providers/readiness"),
  },
  files: {
    access: (id) => request(`/v1/files/${encodeURIComponent(id)}/access`),
  },
  integrations: {
    Core: {
      UploadFile: async ({ file }) => {
        const body = new FormData();
        body.append("file", file);
        return request("/v1/files", { method: "POST", body });
      },
    },
  },
  agents: {
    listConversations: (input = {}) =>
      request("/v1/agents/conversations/list", { method: "POST", body: input }),
    getConversations: () => request("/v1/agents/conversations"),
    getConversation: (id) =>
      request(`/v1/agents/conversations/${encodeURIComponent(id)}`),
    createConversation: (input) =>
      request("/v1/agents/conversations", { method: "POST", body: input }),
    addMessage: async (conversation, input) => {
      const updated = await request(
        `/v1/agents/conversations/${encodeURIComponent(conversation.id || conversation)}/messages`,
        { method: "POST", body: input },
      );
      return updated?.messages?.[updated.messages.length - 1] || input;
    },
    subscribeToConversation: (id, callback) => {
      const key = String(id);
      if (conversationSubscriptions.has(key)) {
        clearInterval(conversationSubscriptions.get(key));
      }
      const timer = setInterval(async () => {
        try {
          callback(await request(`/v1/agents/conversations/${encodeURIComponent(key)}`));
        } catch {
          // A transient polling error must not crash the Studio UI.
        }
      }, 2500);
      conversationSubscriptions.set(key, timer);
      return () => {
        clearInterval(timer);
        conversationSubscriptions.delete(key);
      };
    },
  },
};

export const getStandalonePublicSettings = async () => {
  const settings = await request("/v1/public-settings", { auth: false });
  return { ...settings, has_session: Boolean(accessToken) };
};
