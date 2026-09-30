// Node-only. Where the gateway keeps its small JSON documents (encrypted vault, connections, users, sessions, setup).
//  - FileStateIO: files in a directory (local installs, the default).
//  - CachedStateIO + SupabaseBackend: a Supabase table, for hosts whose disk is not permanent (e.g. Render Free).
// Everything stored here is already safe at rest: secrets are AES-256-GCM ciphertext, sessions are hashed.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export interface StateIO {
  /** Synchronous read of a document (a copy: mutate it freely, then write() it back). */
  read<T>(name: string, fallback: T): T;
  /** Persist a document. Resolves once it is durably stored; rejects (and changes nothing) if it could not be. */
  write(name: string, value: unknown): Promise<void>;
  /** Short label for diagnostics. */
  readonly kind: "file" | "supabase";
}

export class FileStateIO implements StateIO {
  readonly kind = "file" as const;
  private dir: string;
  constructor(dir: string) {
    this.dir = dir;
    mkdirSync(dir, { recursive: true, mode: 0o700 });
  }
  private path(name: string) { return join(this.dir, `${name}.json`); }
  read<T>(name: string, fallback: T): T {
    try { return existsSync(this.path(name)) ? (JSON.parse(readFileSync(this.path(name), "utf8")) as T) : fallback; } catch { return fallback; }
  }
  async write(name: string, value: unknown) {
    writeFileSync(this.path(name), JSON.stringify(value, null, 2), { mode: 0o600 });
  }
}

/** Convenience for constructors that accept either a directory (files) or a ready StateIO. */
export function toStateIO(dirOrIo: string | StateIO): StateIO {
  return typeof dirOrIo === "string" ? new FileStateIO(dirOrIo) : dirOrIo;
}

export interface StateBackend {
  loadAll(): Promise<Record<string, unknown>>;
  save(name: string, value: unknown): Promise<void>;
}

/** Loads every document once at start-up, serves reads from memory, and writes through to the backend. Single-instance only. */
export class CachedStateIO implements StateIO {
  readonly kind = "supabase" as const;
  private cache: Record<string, unknown>;
  private backend: StateBackend;
  private queue: Promise<unknown> = Promise.resolve();
  private constructor(backend: StateBackend, cache: Record<string, unknown>) {
    this.backend = backend;
    this.cache = cache;
  }
  /** Throws if the backend cannot be read: never start "empty" and later overwrite real data. */
  static async open(backend: StateBackend): Promise<CachedStateIO> {
    return new CachedStateIO(backend, await backend.loadAll());
  }
  read<T>(name: string, fallback: T): T {
    return name in this.cache ? (structuredClone(this.cache[name]) as T) : fallback;
  }
  write(name: string, value: unknown): Promise<void> {
    const run = async () => {
      const had = name in this.cache;
      const previous = this.cache[name];
      this.cache[name] = structuredClone(value);
      try {
        await this.backend.save(name, value);
      } catch (err) {
        if (had) this.cache[name] = previous; else delete this.cache[name];
        throw err;
      }
    };
    // Serialise writes so the last write to a document is the last one the backend sees.
    const next = this.queue.then(run, run);
    this.queue = next.catch(() => undefined);
    return next;
  }
}

export class StorageError extends Error {}

/**
 * Supabase through its REST API (PostgREST): plain HTTPS, no database driver, works from hosts without IPv6.
 * Table (see docs): windsword_state(name text primary key, value jsonb, updated_at timestamptz), RLS on with no
 * policies, so only the server's secret key can touch it.
 */
export class SupabaseBackend implements StateBackend {
  private endpoint: string;
  private headers: Record<string, string>;
  private fetchImpl: typeof fetch;
  private retryDelayMs: number;
  constructor(opts: { url: string; key: string; fetch?: typeof fetch; retryDelayMs?: number }) {
    this.endpoint = `${opts.url.replace(/\/+$/, "")}/rest/v1/windsword_state`;
    // New-style secret keys (sb_secret_…) go in `apikey` only; legacy service_role JWTs are also sent as a bearer token.
    this.headers = { apikey: opts.key, ...(opts.key.startsWith("eyJ") ? { authorization: `Bearer ${opts.key}` } : {}) };
    this.fetchImpl = opts.fetch ?? fetch.bind(globalThis);
    this.retryDelayMs = opts.retryDelayMs ?? 500;
  }

  async loadAll(): Promise<Record<string, unknown>> {
    let res: Response;
    try {
      res = await this.fetchImpl(`${this.endpoint}?select=name,value`, { headers: this.headers, signal: AbortSignal.timeout(15_000) });
    } catch {
      throw new StorageError("Could not reach Supabase. Check SUPABASE_URL.");
    }
    if (!res.ok) throw new StorageError(res.status === 404 ? "Supabase is reachable but the windsword_state table does not exist yet. Run the setup SQL." : `Supabase refused the request (HTTP ${res.status}). Check SUPABASE_SERVICE_ROLE_KEY.`);
    const rows = (await res.json()) as { name: string; value: unknown }[];
    return Object.fromEntries(rows.map((r) => [r.name, r.value]));
  }

  async save(name: string, value: unknown): Promise<void> {
    let lastStatus = 0;
    for (let attempt = 0; attempt < 3; attempt++) {
      if (attempt) await new Promise((r) => setTimeout(r, this.retryDelayMs * attempt));
      try {
        const res = await this.fetchImpl(this.endpoint, {
          method: "POST",
          headers: { ...this.headers, "content-type": "application/json", prefer: "resolution=merge-duplicates,return=minimal" },
          body: JSON.stringify({ name, value, updated_at: new Date().toISOString() }),
          signal: AbortSignal.timeout(15_000),
        });
        if (res.ok) return;
        lastStatus = res.status;
        if (res.status < 500 && res.status !== 429) break; // a client error will not fix itself
      } catch { lastStatus = 0; }
    }
    throw new StorageError(`Could not save to Supabase${lastStatus ? ` (HTTP ${lastStatus})` : ""}.`);
  }
}
