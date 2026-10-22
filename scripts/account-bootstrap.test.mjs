import assert from "node:assert/strict";
import test from "node:test";
import { loadAccountState } from "../src/lib/account-bootstrap.js";

test("settings and session outages resolve to a retryable state without raw diagnostics", async () => {
  for (const authOnly of [false, true]) for (const error of [new TypeError("offline"), { status: 503, message: "private host" }, { code: "request_timeout" }]) {
    const fail = async () => { throw error; };
    const result = await loadAccountState({ getPublicSettings: fail, getUser: fail, authOnly });
    assert.equal(result.authError.type, "service_unavailable");
    assert.equal(result.isAuthenticated, false);
    assert.equal(result.user, null);
    assert.doesNotMatch(result.authError.message, /private host|password/);
  }
});

test("one retry after an outage recovers the session without a sign-in or job submission", async () => {
  let attempts = 0;
  const getPublicSettings = async () => { if (++attempts === 1) throw { status: 503 }; return { has_session: true }; };
  let meCalls = 0;
  const getUser = async () => { meCalls++; return { id: "owner" }; };
  assert.equal((await loadAccountState({ getPublicSettings, getUser })).authError.type, "service_unavailable");
  const result = await loadAccountState({ getPublicSettings, getUser });
  assert.deepEqual(result.user, { id: "owner" });
  assert.equal(result.isAuthenticated, true);
  assert.equal(result.authError, null);
  assert.equal(meCalls, 1);
});

test("expired sessions, unregistered users and anonymous visitors keep distinct access paths", async () => {
  const getPublicSettings = async () => ({ has_session: true });
  for (const [error, expected] of [[{ status: 401 }, "auth_required"], [{ status: 403 }, "auth_required"],
    [{ status: 403, data: { extra_data: { reason: "user_not_registered" } } }, "user_not_registered"]]) {
    const result = await loadAccountState({ getPublicSettings, getUser: async () => { throw error; } });
    assert.equal(result.authError.type, expected);
  }
  const result = await loadAccountState({ getPublicSettings: async () => ({}), getUser: async () => { throw new Error("must not check anonymous session"); } });
  assert.equal(result.authError, null);
  assert.equal(result.isAuthenticated, false);
});
