// Node-only. Encrypted credential vault (AES-256-GCM) + persistent connection metadata.
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { toStateIO, type StateIO } from "./state.ts";
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
  private io: StateIO;
  private key: Buffer;
  constructor(dirOrIo: string | StateIO, key: Buffer) {
    this.io = toStateIO(dirOrIo);
    this.key = key;
  }
  private read(): VaultFile {
    return this.io.read<VaultFile>("vault", { version: 1, entries: {} });
  }
  async put(secret: string) {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.key, iv);
    const ct = Buffer.concat([cipher.update(secret, "utf8"), cipher.final()]);
    const ref = `sec_${randomBytes(9).toString("hex")}`;
    const file = this.read();
    file.entries[ref] = { iv: iv.toString("base64"), tag: cipher.getAuthTag().toString("base64"), ct: ct.toString("base64") };
    await this.io.write("vault", file);
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
    await this.io.write("vault", file);
  }
}

export class FileConnectionStore implements ConnectionStore {
  private io: StateIO;
  constructor(dirOrIo: string | StateIO) {
    this.io = toStateIO(dirOrIo);
  }
  private read(): Record<string, Connection> {
    return this.io.read<Record<string, Connection>>("connections", {});
  }
  async get(id: string) {
    return this.read()[id];
  }
  async set(c: Connection) {
    const all = this.read();
    all[c.providerId] = c;
    await this.io.write("connections", all);
  }
  async delete(id: string) {
    const all = this.read();
    delete all[id];
    await this.io.write("connections", all);
  }
  async all() {
    return Object.values(this.read());
  }
}
