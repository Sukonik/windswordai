import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { CREDENTIALS, credentialStatus, formatStatus } from "../scripts/credential-status.mjs";
import { jsonResponse } from "./helpers.mjs";

const VALUES = {
  WINDSWORD_GOOGLE_CLIENT_SECRET: "fake-google-secret-for-tests-only-123",
  OPENAI_API_KEY: "fake-openai-key-for-tests-only-456",
};

test("reports configured / missing per name; checks only where a checker exists; output contains no values", async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => jsonResponse({ error: "invalid_grant" }, 400);
  try {
    const rows = await credentialStatus(VALUES);
    const by = Object.fromEntries(rows.map((r) => [r.name, r]));
    assert.equal(by.WINDSWORD_GOOGLE_CLIENT_SECRET.result, "PASS ✓");
    assert.equal(by.OPENAI_API_KEY.configured, true);
    assert.equal(by.OPENAI_API_KEY.result, undefined, "no checker yet: configured only");
    assert.equal(by.ANTHROPIC_API_KEY.configured, false);
    const text = formatStatus(rows);
    for (const v of Object.values(VALUES)) assert.ok(!text.includes(v), "no secret value in output");
    assert.match(text, /ANTHROPIC_API_KEY: missing ✗/);
  } finally { globalThis.fetch = realFetch; }
});

test("a rejected Google pair shows FAIL, and a throwing checker shows FAIL without leaking", async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => jsonResponse({ error: "invalid_client" }, 401);
  try {
    const rows = await credentialStatus({ WINDSWORD_GOOGLE_CLIENT_SECRET: VALUES.WINDSWORD_GOOGLE_CLIENT_SECRET });
    assert.equal(rows[0].result, "FAIL ✗");
    const boom = await credentialStatus({ X: "v-secret-value" }, [{ name: "X", label: "x", check: async () => { throw new Error("v-secret-value leaked"); } }]);
    assert.equal(boom[0].result, "FAIL ✗");
    assert.ok(!formatStatus(boom).includes("v-secret-value"));
  } finally { globalThis.fetch = realFetch; }
});

test("the workflow passes exactly the canonical names (keeps registry and workflow in sync) and stays manual + read-only", () => {
  const y = readFileSync(new URL("../.github/workflows/credential-status.yml", import.meta.url), "utf8");
  for (const c of CREDENTIALS) assert.match(y, new RegExp(`${c.name}: \\$\\{\\{ secrets\\.${c.name} \\}\\}`), `${c.name} is wired`);
  const wired = [...y.matchAll(/secrets\.([A-Z0-9_]+)/g)].map((m) => m[1]);
  assert.deepEqual(new Set(wired), new Set(CREDENTIALS.map((c) => c.name)), "no unlisted secrets");
  assert.match(y, /on:\s*\n\s*workflow_dispatch:/);
  assert.doesNotMatch(y, /pull_request|push:/);
  assert.match(y, /permissions:\s*\n\s*contents: read/);
});
