// Node-only. Encrypted credential vault (AES-256-GCM) + persistent connection metadata.
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { Connection } from "./types.ts";
import type { ConnectionStore, SecretStore } from "./stores.ts";

interface VaultFile {
  version: 1;
  entries: Record<string, { iv: string; tag: string; ct: string }>;
}

/** Key from WINDSWORD_VAULT_KEY (base64, 32 bytes) or a 0600 key file created on first use. */
export function loadVaultKey(dir: string, env: Record<string, string | undefined> = process.env): Buffer {
  if (env.WINDSWORD_VAULT_KEY) {
    const key = Buffer.from(env.WINDSWORD_VAULT_KEY, "base64");
    if (key.length !== 32) throw new Error("WINDSWORD_VAULT_KEY must be 32 bytes, base64-encoded.");
    return key;
  }
  const keyPath = join(dir, "vault.key");
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  if (existsSync(keyPath)) return Buffer.from(readFileSync(keyPath, "utf8").trim(), "base64");
  const key = randomBytes(32);
  writeFileSync(keyPath, key.toString("base64"), { mode: 0o600 });
  chmodSync(keyPath, 0o600);
  return key;
}

export class FileSecretStore implements SecretStore {
  private path: string;
  private key: Buffer;
  constructor(dir: string, key: Buffer) {
    this.path = join(dir, "vault.json");
    this.key = key;
    mkdirSync(dir, { recursive: true, mode: 0o700 });
  }
  private read(): VaultFile {
    return existsSync(this.path) ? (JSON.parse(readFileSync(this.path, "utf8")) as VaultFile) : { version: 1, entries: {} };
  }
  private write(v: VaultFile) {
    writeFileSync(this.path, JSON.stringify(v), { mode: 0o600 });
  }
  async put(secret: string) {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.key, iv);
    const ct = Buffer.concat([cipher.update(secret, "utf8"), cipher.final()]);
    const ref = `sec_${randomBytes(9).toString("hex")}`;
    const file = this.read();
    file.entries[ref] = { iv: iv.toString("base64"), tag: cipher.getAuthTag().toString("base64"), ct: ct.toString("base64") };
    this.write(file);
    return ref;
  }
  async get(ref: string) {
    const entry = this.read().entries[ref];
    if (!entry) return undefined;
    const decipher = createDecipheriv("aes-256-gcm", this.key, Buffer.from(entry.iv, "base64"));
    decipher.setAuthTag(Buffer.from(entry.tag, "base64"));
    return Buffer.concat([decipher.update(Buffer.from(entry.ct, "base64")), decipher.final()]).toString("utf8");
  }
  async delete(ref: string) {
    const file = this.read();
    delete file.entries[ref];
    this.write(file);
  }
}

export class FileConnectionStore implements ConnectionStore {
  private path: string;
  constructor(dir: string) {
    this.path = join(dir, "connections.json");
    mkdirSync(dirname(this.path), { recursive: true, mode: 0o700 });
  }
  private read(): Record<string, Connection> {
    return existsSync(this.path) ? (JSON.parse(readFileSync(this.path, "utf8")) as Record<string, Connection>) : {};
  }
  async get(id: string) {
    return this.read()[id];
  }
  async set(c: Connection) {
    const all = this.read();
    all[c.providerId] = c;
    writeFileSync(this.path, JSON.stringify(all, null, 2), { mode: 0o600 });
  }
  async delete(id: string) {
    const all = this.read();
    delete all[id];
    writeFileSync(this.path, JSON.stringify(all, null, 2), { mode: 0o600 });
  }
  async all() {
    return Object.values(this.read());
  }
}
