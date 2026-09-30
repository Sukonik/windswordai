// WindSword Connect: describe a service connection as data; one generic renderer and one generic
// store handle every provider. Adding Dropbox, Drive, S3/R2 … means adding a definition, not a page.
import type { AuthService } from "../auth.ts";

export type FieldType = "text" | "url" | "password" | "select" | "checkbox";

export interface FieldDef {
  name: string;
  label: string;
  type: FieldType;
  /** Secret fields are stored only in the encrypted vault and are never sent back to the browser. */
  secret: boolean;
  required?: boolean;
  placeholder?: string;
  help?: string;
  /** For type "select". */
  options?: { value: string; label: string }[];
  pattern?: RegExp;
  patternMessage?: string;
  minLength?: number;
  maxLength?: number;
}

export type FieldValues = Record<string, string | boolean>;

/** Server-side services a definition may use. Never exposed to the browser. */
export interface ConnectRuntime {
  auth: AuthService;
  env: Record<string, string | undefined>;
  fetch: typeof fetch;
  /** Public https origin of this gateway, when known. */
  publicOrigin?: string;
}

export interface TestResult { ok: boolean; message: string }

export type ConnectionGroup = "Identity" | "AI Providers" | "Storage" | "Local Services";

export interface ConnectionDefinition {
  id: string;
  name: string;
  group: ConnectionGroup;
  description: string;
  fields: FieldDef[];
  /** Listed on the Connections page but not configurable yet. */
  comingSoon?: boolean;
  /** True when the server environment already supplies this connection (nothing to paste). */
  envManaged?(env: Record<string, string | undefined>): boolean;
  /** Technical addresses to register with the provider. Shown only under Advanced. */
  registerWithProvider?(origin: string): { label: string; value: string }[];
  /** Put saved values into effect immediately (no restart). `values` includes secrets; server-side only. */
  apply?(values: FieldValues, rt: ConnectRuntime): void | Promise<void>;
  /** Undo apply() when the connection is removed. */
  clear?(rt: ConnectRuntime): void | Promise<void>;
  /** Check the saved credentials with the provider. Must never include secret values in its message. */
  test?(values: FieldValues, rt: ConnectRuntime): Promise<TestResult>;
  /** Optional extra "try it" link shown when configured (e.g. a real sign-in round trip). */
  tryLink?: { href: string; label: string };
  /** Provider-specific help shown under Advanced. */
  advancedNote?: string;
}

export class ConnectError extends Error {}

/** Validate submitted values against a definition. Messages are fixed strings: they never echo input. */
export function validateInput(def: ConnectionDefinition, input: Record<string, string>, hasSecret: (name: string) => boolean): FieldValues {
  const out: FieldValues = {};
  for (const f of def.fields) {
    const raw = (input[f.name] ?? "").trim();
    if (f.type === "checkbox") { out[f.name] = raw === "on"; continue; }
    if (!raw) {
      if (f.required && !(f.secret && hasSecret(f.name))) throw new ConnectError(`${f.label} is required.`);
      continue;
    }
    if (f.minLength && raw.length < f.minLength) throw new ConnectError(`${f.label} looks too short. Copy it again from the provider.`);
    if (raw.length > (f.maxLength ?? 512)) throw new ConnectError(`${f.label} looks too long. Copy it again from the provider.`);
    if (f.secret && /[\s\u0000-\u001f<>"']/.test(raw)) throw new ConnectError(`${f.label} has characters it shouldn’t. Copy it again, with nothing extra.`);
    if (f.type === "select" && !(f.options ?? []).some((o) => o.value === raw)) throw new ConnectError(`Choose a valid ${f.label}.`);
    if (f.type === "url" && !/^https?:\/\/[^\s]+$/i.test(raw)) throw new ConnectError(`${f.label} should be a web address starting with https://`);
    if (f.pattern && !f.pattern.test(raw)) throw new ConnectError(f.patternMessage ?? `${f.label} doesn’t look right.`);
    out[f.name] = raw;
  }
  return out;
}
