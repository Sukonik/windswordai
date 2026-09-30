import { toStateIO, type StateIO } from "../state.ts";
import type { SecretStore } from "../stores.ts";
import { validateInput, type ConnectionDefinition, type FieldValues } from "./schema.ts";

interface Entry {
  /** Non-secret values, stored in the clear. */
  public: Record<string, string | boolean>;
  /** Secret field -> vault reference. Raw secrets are only in the encrypted vault. */
  secretRefs: Record<string, string>;
  updatedAt: string;
}
interface File { version: 1; connections: Record<string, Entry> }

export interface ConnectionStatus {
  configured: boolean;
  /** Public values only. */
  values: Record<string, string | boolean>;
  /** Which secret fields are set. Never their values. */
  secretsSet: Record<string, boolean>;
  updatedAt?: string;
}

export class ConnectStore {
  private io: StateIO;
  private secrets: SecretStore;
  constructor(dirOrIo: string | StateIO, secrets: SecretStore) {
    this.io = toStateIO(dirOrIo);
    this.secrets = secrets;
  }

  // Document "connect" (not "connections": that one belongs to the per-user AI connection store).
  private read(): File {
    const f = this.io.read<Partial<File>>("connect", {});
    return { version: 1, connections: f.connections ?? {} };
  }
  private write(f: File) { return this.io.write("connect", f); }

  status(def: ConnectionDefinition): ConnectionStatus {
    const e = this.read().connections[def.id];
    const secretsSet: Record<string, boolean> = {};
    for (const f of def.fields) if (f.secret) secretsSet[f.name] = Boolean(e?.secretRefs[f.name]);
    const configured = Boolean(e) && def.fields.every((f) => !f.required || (f.secret ? secretsSet[f.name] : Boolean(e?.public[f.name])));
    return { configured, values: { ...(e?.public ?? {}) }, secretsSet, updatedAt: e?.updatedAt };
  }

  /** Server-side only: public values plus decrypted secrets. Undefined when not fully configured. */
  async resolve(def: ConnectionDefinition): Promise<FieldValues | undefined> {
    if (!this.status(def).configured) return undefined;
    const e = this.read().connections[def.id]!;
    const out: FieldValues = { ...e.public };
    for (const [name, ref] of Object.entries(e.secretRefs)) {
      const v = await this.secrets.get(ref).catch(() => undefined);
      if (v === undefined) return undefined;
      out[name] = v;
    }
    return out;
  }

  /** Save submitted values. An empty secret field keeps the stored one. Throws ConnectError on bad input. */
  async save(def: ConnectionDefinition, input: Record<string, string>): Promise<void> {
    const file = this.read();
    const prev = file.connections[def.id];
    const clean = validateInput(def, input, (n) => Boolean(prev?.secretRefs[n]));
    const entry: Entry = { public: {}, secretRefs: { ...(prev?.secretRefs ?? {}) }, updatedAt: new Date().toISOString() };
    for (const f of def.fields) {
      const v = clean[f.name];
      if (f.secret) {
        if (typeof v === "string" && v) {
          const old = entry.secretRefs[f.name];
          entry.secretRefs[f.name] = await this.secrets.put(v);
          if (old) await this.secrets.delete(old);
        }
      } else if (v !== undefined) entry.public[f.name] = v;
    }
    file.connections[def.id] = entry;
    await this.write(file);
  }

  async remove(def: ConnectionDefinition): Promise<void> {
    const file = this.read();
    const e = file.connections[def.id];
    if (!e) return;
    for (const ref of Object.values(e.secretRefs)) await this.secrets.delete(ref);
    delete file.connections[def.id];
    await this.write(file);
  }
}
