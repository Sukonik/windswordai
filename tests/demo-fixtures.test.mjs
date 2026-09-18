import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("demo fixture is explicitly synthetic", () => {
  const data = JSON.parse(readFileSync(new URL("../fixtures/demo.json", import.meta.url), "utf8"));
  assert.match(data.notice, /Synthetic demo data only/i);
  assert.ok(Array.isArray(data.documents));
  assert.ok(data.documents.length > 0);
});
