import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { test } from "node:test";

const loadClient = async (t, { storedToken = "trusted-session", blockedStorage = false, mode = "browser", fetchImpl } = {}) => {
  const previousWindow = globalThis.window;
  const previousFetch = globalThis.fetch;
  const values = new Map(storedToken ? [["iabt_access_token", storedToken]] : []);
  globalThis.window = {
    location: { search: "?access_token=attacker-session", origin: "https://app.example.test", assign() {} },
    get localStorage() {
      if (blockedStorage) throw new Error("Storage disabled");
      return { getItem: (key) => values.get(key), setItem: (key, value) => values.set(key, value), removeItem: (key) => values.delete(key) };
    }
  };
  globalThis.fetch = fetchImpl;
  t.after(() => { globalThis.window = previousWindow; globalThis.fetch = previousFetch; });
  const routingSource = (await readFile(new URL("../../src/lib/routing.js", import.meta.url), "utf8"))
    .replace("import.meta.env?.VITE_IABT_ROUTING", JSON.stringify(mode));
  const routingModule = `data:text/javascript;base64,${Buffer.from(routingSource).toString("base64")}`;
  const source = (await readFile(new URL("../../src/api/standaloneClient.js", import.meta.url), "utf8"))
    .replace("import.meta.env.VITE_IABT_API_URL", JSON.stringify("https://api.example.test"))
    .replace('"../lib/routing.js"', JSON.stringify(routingModule));
  const module = await import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}#${randomUUID()}`);
  return { client: module.standaloneClient, values };
};

test("standalone session ignores URL tokens and expired sessions clear persisted credentials", async (t) => {
  const headers = [];
  let expired = false;
  const { client, values } = await loadClient(t, {
    fetchImpl: async (_url, options) => {
      headers.push(options.headers.get("Authorization"));
      assert.ok(options.signal instanceof AbortSignal);
      return new Response(expired ? '{"message":"Session expired"}' : '{"id":"user"}', { status: expired ? 401 : 200 });
    }
  });
  await client.auth.me();
  assert.equal(headers[0], "Bearer trusted-session");
  expired = true;
  await assert.rejects(client.auth.me(), (error) => error.status === 401);
  assert.equal(values.has("iabt_access_token"), false);
});

test("standalone login works in a tab with browser storage disabled", async (t) => {
  const { client } = await loadClient(t, {
    blockedStorage: true,
    fetchImpl: async () => new Response('{"access_token":"verified-session"}')
  });
  assert.equal((await client.auth.loginViaEmailPassword("test@example.test", "password")).access_token, "verified-session");
});

test("HTML gateway failures become actionable errors without exposing the gateway page", async (t) => {
  const { client } = await loadClient(t, {
    fetchImpl: async () => new Response("<html>private upstream diagnostic</html>", { status: 502 })
  });
  await assert.rejects(client.auth.me(), (error) => error.status === 502 && !error.message.includes("private") && !error.message.includes("JSON"));
});

test("standalone requests abort within a bounded timeout without retrying mutations", async (t) => {
  const setTimeoutOriginal = globalThis.setTimeout;
  globalThis.setTimeout = (callback, delay) => {
    assert.equal(delay, 30000);
    return setTimeoutOriginal(callback, 1);
  };
  t.after(() => { globalThis.setTimeout = setTimeoutOriginal; });
  let attempts = 0;
  const { client } = await loadClient(t, {
    fetchImpl: async (_url, options) => {
      attempts += 1;
      return new Promise((_resolve, reject) => options.signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true }));
    }
  });
  await assert.rejects(client.auth.register({ email: "test@example.test", password: "password" }), (error) => error.code === "request_timeout");
  assert.equal(attempts, 1);
});


test("standalone redirects preserve hash deep links and reject off-origin logout targets", async (t) => {
  const { client } = await loadClient(t, { mode: "hash", fetchImpl: async () => new Response('{"ok":true}') });
  const destinations = [];
  window.location.assign = (target) => destinations.push(target);
  client.auth.redirectToLogin("https://app.example.test/#/projects/abc?tab=files");
  assert.equal(destinations.pop(), "/#/login?returnTo=%2Fprojects%2Fabc%3Ftab%3Dfiles");
  await client.auth.logout("https://attacker.example.test/");
  assert.equal(destinations.pop(), "/#/");
});
