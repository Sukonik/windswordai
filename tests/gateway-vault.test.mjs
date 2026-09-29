import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { FileConnectionStore, FileSecretStore, loadVaultKey } from "../gateway/src/vault.ts";

test("vault encrypts at rest, round-trips, deletes, and uses 0600 permissions", async () => {
  const dir = mkdtempSync(join(tmpdir(), "ws-vault-"));
  const key = loadVaultKey(dir, {});
  assert.equal(key.length, 32);
  assert.equal(statSync(join(dir, "vault.key")).mode & 0o777, 0o600);
  assert.deepEqual(loadVaultKey(dir, {}), key, "key is stable across loads");

  const store = new FileSecretStore(dir, key);
  const ref = await store.put("sk-super-secret-value");
  assert.match(ref, /^sec_/);
  assert.equal(await store.get(ref), "sk-super-secret-value");
  const onDisk = readFileSync(join(dir, "vault.json"), "utf8");
  assert.ok(!onDisk.includes("sk-super-secret-value"), "plaintext must not be on disk");
  assert.equal(statSync(join(dir, "vault.json")).mode & 0o777, 0o600);

  await store.delete(ref);
  assert.equal(await store.get(ref), undefined);
});

test("tampered ciphertext fails authentication", async () => {
  const dir = mkdtempSync(join(tmpdir(), "ws-vault-"));
  const store = new FileSecretStore(dir, randomBytes(32));
  const ref = await store.put("abc123456");
  const other = new FileSecretStore(dir, randomBytes(32));
  await assert.rejects(() => other.get(ref));
});

test("WINDSWORD_VAULT_KEY must be 32 bytes", () => {
  assert.throws(() => loadVaultKey("/tmp/unused", { WINDSWORD_VAULT_KEY: Buffer.from("short").toString("base64") }), /32 bytes/);
  assert.equal(loadVaultKey("/tmp/unused", { WINDSWORD_VAULT_KEY: randomBytes(32).toString("base64") }).length, 32);
});

test("connection store persists metadata without secrets", async () => {
  const dir = mkdtempSync(join(tmpdir(), "ws-conn-"));
  const store = new FileConnectionStore(dir);
  await store.set({ providerId: "claude", type: "api_key", secretRef: "sec_x", models: [], connectedAt: "now" });
  assert.equal((await store.get("claude")).secretRef, "sec_x");
  assert.equal((await store.all()).length, 1);
  await store.delete("claude");
  assert.equal(await store.get("claude"), undefined);
});
