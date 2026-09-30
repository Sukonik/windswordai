import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DEFAULT_CLIENT_ID, runCheck } from "../scripts/check-google-credentials.mjs";
import { jsonResponse } from "./helpers.mjs";

const SECRET = "fake-google-secret-for-tests-only-123";

test("missing secret: reports 'not configured' and makes no network call", async () => {
  let called = false;
  const r = await runCheck({}, async () => { called = true; return jsonResponse({}); });
  assert.equal(r.configured, false);
  assert.equal(r.ok, false);
  assert.equal(called, false);
});

test("pass when Google accepts the client and only rejects the fake code; fail on invalid_client; secret never in output", async () => {
  let body;
  const fetchFor = (answer, status) => async (_url, init) => { body = init.body.toString(); return jsonResponse(answer, status); };
  const pass = await runCheck({ WINDSWORD_GOOGLE_CLIENT_SECRET: SECRET }, fetchFor({ error: "invalid_grant" }, 400));
  assert.deepEqual([pass.configured, pass.ok], [true, true]);
  assert.ok(body.includes(`client_id=${encodeURIComponent(DEFAULT_CLIENT_ID)}`), "uses the public client id by default");
  const fail = await runCheck({ WINDSWORD_GOOGLE_CLIENT_SECRET: SECRET, WINDSWORD_GOOGLE_CLIENT_ID: "123-x.apps.googleusercontent.com" }, fetchFor({ error: "invalid_client" }, 401));
  assert.deepEqual([fail.configured, fail.ok], [true, false]);
  for (const r of [pass, fail]) assert.ok(!JSON.stringify(r).includes(SECRET));
});

test("the workflow is manual-only, read-only, and passes the secret only as an environment variable to the status script", () => {
  const y = readFileSync(new URL("../.github/workflows/google-credential-check.yml", import.meta.url), "utf8");
  assert.match(y, /on:\s*\n\s*workflow_dispatch:/);
  assert.doesNotMatch(y, /pull_request|push:/, "never triggered by pull requests or pushes");
  assert.match(y, /permissions:\s*\n\s*contents: read/);
  assert.match(y, /secrets\.WINDSWORD_GOOGLE_CLIENT_SECRET/);
  assert.doesNotMatch(y, /echo .*secrets\./, "never echoes a secret");
});
