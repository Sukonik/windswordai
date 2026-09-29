import test from "node:test";
import assert from "node:assert/strict";
import { parseVersion, tsSupport } from "../scripts/lib-node.mjs";

test("parses node version strings", () => {
  assert.deepEqual(parseVersion("v22.22.2"), { major: 22, minor: 22, patch: 2 });
  assert.deepEqual(parseVersion("20.11.0"), { major: 20, minor: 11, patch: 0 });
});

test("Node with unflagged TypeScript support runs the gateway directly", () => {
  for (const v of ["v22.18.0", "v22.22.2", "v23.6.0", "v24.1.0"]) assert.deepEqual(tsSupport(v), { ok: true, flag: [] }, v);
});

test("Node 22.6-22.17 gets the strip-types flag", () => {
  for (const v of ["v22.6.0", "v22.12.1", "v22.17.9"]) assert.deepEqual(tsSupport(v), { ok: true, flag: ["--experimental-strip-types"] }, v);
});

test("Node older than 22 fails with a friendly message", () => {
  for (const v of ["v18.19.0", "v20.11.1", "v22.5.0"]) {
    const s = tsSupport(v);
    assert.equal(s.ok, false, v);
    assert.match(s.message, /Node 22 or newer/);
  }
});
