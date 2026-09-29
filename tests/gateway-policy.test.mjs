import test from "node:test";
import assert from "node:assert/strict";
import { decide, decideCompare } from "../gateway/src/policy.ts";
import { anthropicDescriptor } from "../gateway/src/providers/anthropic.ts";
import { ollamaDescriptor } from "../gateway/src/providers/ollama.ts";
import { mockDescriptor } from "../gateway/src/providers/mock.ts";

const cloud = anthropicDescriptor;
const base = { contentClass: "general", attachmentCount: 0 };

const table = [
  // name, ctx, allow, code
  ["local always allowed in secure local", { mode: "secure_local", provider: ollamaDescriptor, connected: true, ...base }, true, "allowed"],
  ["mock allowed in secure local", { mode: "secure_local", provider: mockDescriptor, connected: true, ...base }, true, "allowed"],
  ["cloud blocked in secure local even when connected", { mode: "secure_local", provider: cloud, connected: true, ...base }, false, "secure_local_blocks_cloud"],
  ["cloud not connected in standard", { mode: "standard", provider: cloud, connected: false, ...base }, false, "not_connected"],
  ["cloud connected general prompt in standard", { mode: "standard", provider: cloud, connected: true, ...base }, true, "allowed"],
  ["cloud blocked for protected content", { mode: "standard", provider: cloud, connected: true, contentClass: "protected" }, false, "protected_content_blocks_cloud"],
  ["cloud blocked when any document attached", { mode: "standard", provider: cloud, connected: true, contentClass: "general", attachmentCount: 1 }, false, "protected_content_blocks_cloud"],
  ["cloud allowed for protected only if explicitly approved", { mode: "standard", provider: cloud, connected: true, contentClass: "protected", approvedForProtected: new Set(["claude"]) }, true, "allowed"],
  ["local allowed for protected content", { mode: "standard", provider: ollamaDescriptor, connected: true, contentClass: "protected", attachmentCount: 3 }, true, "allowed"],
  ["disabled provider denied", { mode: "standard", provider: { ...cloud, enabled: false }, connected: true, ...base }, false, "provider_disabled"],
  ["unknown provider denied", { mode: "standard", provider: undefined, connected: false, ...base }, false, "unknown_provider"],
];

for (const [name, ctx, allow, code] of table) {
  test(`policy: ${name}`, () => {
    const d = decide(ctx);
    assert.equal(d.allow, allow);
    assert.equal(d.code, code);
    assert.ok(d.reason.length > 0);
  });
}

test("policy: default posture is no egress (no approvals, secure local)", () => {
  assert.equal(decide({ mode: "secure_local", provider: cloud, connected: true, contentClass: "general" }).allow, false);
});

test("compare: each side is decided independently, no silent duplication of documents", () => {
  const decisions = decideCompare(
    { mode: "standard", contentClass: "general", attachmentCount: 2 },
    [
      { provider: cloud, connected: true },
      { provider: ollamaDescriptor, connected: true },
    ],
  );
  assert.equal(decisions[0].allow, false); // cloud side blocked
  assert.equal(decisions[1].allow, true); // local side allowed
});

test("compare: two cloud providers, general prompt, both connected -> both allowed independently", () => {
  const openai = { ...cloud, id: "openai", displayName: "OpenAI" };
  const d = decideCompare({ mode: "standard", contentClass: "general" }, [
    { provider: cloud, connected: true },
    { provider: openai, connected: false },
  ]);
  assert.deepEqual(d.map((x) => x.allow), [true, false]);
});
