import type { Connection } from "./types.ts";

export interface SecretStore {
  /** Store a secret and return an opaque reference. Raw secrets never leave this store except via get(). */
  put(secret: string): Promise<string>;
  get(ref: string): Promise<string | undefined>;
  delete(ref: string): Promise<void>;
}

export interface ConnectionStore {
  get(providerId: string): Promise<Connection | undefined>;
  set(connection: Connection): Promise<void>;
  delete(providerId: string): Promise<void>;
  all(): Promise<Connection[]>;
}

export class MemorySecretStore implements SecretStore {
  private map = new Map<string, string>();
  async put(secret: string) {
    const ref = `sec_${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
    this.map.set(ref, secret);
    return ref;
  }
  async get(ref: string) {
    return this.map.get(ref);
  }
  async delete(ref: string) {
    this.map.delete(ref);
  }
}

export class MemoryConnectionStore implements ConnectionStore {
  private map = new Map<string, Connection>();
  async get(id: string) {
    return this.map.get(id);
  }
  async set(c: Connection) {
    this.map.set(c.providerId, c);
  }
  async delete(id: string) {
    this.map.delete(id);
  }
  async all() {
    return [...this.map.values()];
  }
}
