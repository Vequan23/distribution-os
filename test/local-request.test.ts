import assert from "node:assert/strict";
import test from "node:test";
import { isTrustedLocalRequest } from "../server/local-request.ts";

test("local request guard blocks DNS rebinding and cross-site browser mutations", () => {
  assert.equal(isTrustedLocalRequest({ method: "GET", host: "127.0.0.1:4191" }), true);
  assert.equal(isTrustedLocalRequest({ method: "POST", host: "localhost:4191", origin: "http://127.0.0.1:4190" }), true);
  assert.equal(isTrustedLocalRequest({ method: "POST", host: "127.0.0.1:4191" }), true);
  assert.equal(isTrustedLocalRequest({ method: "POST", host: "attacker.example", origin: "https://attacker.example" }), false);
  assert.equal(isTrustedLocalRequest({ method: "POST", host: "127.0.0.1:4191", origin: "https://attacker.example" }), false);
  assert.equal(isTrustedLocalRequest({ method: "POST", host: "127.0.0.1:4191", origin: "http://127.0.0.1:4190", secFetchSite: "cross-site" }), false);
});
