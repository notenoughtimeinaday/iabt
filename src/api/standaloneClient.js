const trimSlash = (value) => String(value || "").replace(/\/+$/, "");
const apiUrl = trimSlash(import.meta.env.VITE_IABT_API_URL);

const storage =
  typeof window === "undefined"
    ? null
    : window.localStorage;

let accessToken =
  (typeof window === "undefined"
    ? null
    : new URLSearchParams(window.location.search).get("access_token")) ||
  storage?.getItem("iabt_access_token") ||
  null;

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

  const response = await fetch(`${apiUrl}${path}`, {
    method: options.method || "GET",
    headers,
    body:
      options.body instanceof FormData || typeof options.body === "string"
        ? options.body
        : options.body
          ? JSON.stringify(options.body)
          : undefined,
  });

  const text = await response.text();
  const payload = text ? JSON.parse(text) : null;
  if (!response.ok) {
    const error = new Error(payload?.message || `IABT API request failed (${response.status})`);
    error.status = response.status;
    error.data = payload;
    throw error;
  }
  return payload;
};

const entity = (name) => ({
  list: (sort = "-created_date", limit = 50, skip = 0) =>
    request(`/v1/entities/${encodeURIComponent(name)}/list`, {
      method: "POST",
      body: { sort, limit, skip },
    }),
  filter: (query = {}, sort = "-created_date", limit = 50, skip = 0) =>
    request(`/v1/entities/${encodeURIComponent(name)}/filter`, {
      method: "POST",
      body: { query, sort, limit, skip },
    }),
  get: (id) =>
    request(`/v1/entities/${encodeURIComponent(name)}/${encodeURIComponent(id)}`),
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
});

const entities = new Proxy(
  {},
  {
    get: (_target, name) => entity(String(name)),
  },
);

const setToken = (token) => {
  accessToken = token || null;
  if (!storage) return;
  if (accessToken) storage.setItem("iabt_access_token", accessToken);
  else storage.removeItem("iabt_access_token");
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
    verifyOtp: (input) =>
      request("/v1/auth/verify-otp", { method: "POST", auth: false, body: input }),
    resendOtp: (email) =>
      request("/v1/auth/resend-otp", { method: "POST", auth: false, body: { email } }),
    resetPasswordRequest: (email) =>
      request("/v1/auth/reset-request", { method: "POST", auth: false, body: { email } }),
    resetPassword: (input) =>
      request("/v1/auth/reset", { method: "POST", auth: false, body: input }),
    loginWithProvider: oauthRedirect,
    logout: (returnTo) => {
      setToken(null);
      if (returnTo && typeof window !== "undefined") window.location.assign(returnTo);
    },
    redirectToLogin: (returnTo) => {
      if (typeof window === "undefined") return;
      const url = new URL("/login", window.location.origin);
      if (returnTo) url.searchParams.set("returnTo", returnTo);
      window.location.assign(url.toString());
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
    addMessage: (conversation, input) =>
      request(
        `/v1/agents/conversations/${encodeURIComponent(conversation.id || conversation)}/messages`,
        { method: "POST", body: input },
      ),
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
