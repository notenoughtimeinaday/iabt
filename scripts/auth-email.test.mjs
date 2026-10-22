import assert from "node:assert/strict";
import { test } from "node:test";
import { isValidAccountEmail } from "../shared/auth-email.js";

test("verification accepts plus aliases without changing identity", () => {
  assert.equal(isValidAccountEmail("  owner+stage-b@example.com  "), true);
});

test("verification rejects copied list markers and malformed addresses", () => {
  for (const value of ["- owner@example.com", "• owner@example.com", "owner example.com", "owner@@example.com", "owner@example", "", null, {}, "a".repeat(250) + "@example.com"]) {
    assert.equal(isValidAccountEmail(value), false);
  }
});
