// Browser client for WindSword Connect (Settings → Connections). The browser only ever receives status flags:
// existing secrets are never sent back. Secrets typed by the administrator go straight to the gateway over
// the request body and are not kept anywhere in the browser.
export type ConnectionStatusLabel = "connected" | "ready" | "needs_setup" | "error" | "coming_soon";

export interface AdminField {
  name: string;
  label: string;
  type: "text" | "url" | "password" | "select" | "checkbox";
  secret: boolean;
  required: boolean;
  placeholder?: string;
  help?: string;
  options?: { value: string; label: string }[];
}

export interface AdminConnection {
  id: string;
  name: string;
  group: "Identity" | "AI Providers" | "Storage" | "Local Services";
  description: string;
  comingSoon: boolean;
  managedByServer: boolean;
  status: ConnectionStatusLabel;
  canTest: boolean;
  fields: AdminField[];
  values: Record<string, string | boolean>;
  secretsSet: Record<string, boolean>;
  advanced: { note?: string; items: { label: string; value: string }[] };
  tryLink?: { href: string; label: string };
  lastTest?: { ok: boolean; message: string };
}

export type AdminList =
  | { access: "ok"; csrfToken: string; connections: AdminConnection[] }
  | { access: "locked"; googleAdmin?: boolean }
  | { access: "disabled"; message: string };

export class AdminError extends Error {}

export function createAdminClient(baseUrl: string) {
  const base = baseUrl.replace(/\/+$/, "");
  async function call<T>(method: string, path: string, body?: unknown, csrf?: string): Promise<T> {
    const res = await fetch(`${base}${path}`, {
      method,
      credentials: "include",
      headers: { ...(body !== undefined ? { "content-type": "application/json" } : {}), ...(csrf ? { "x-csrf-token": csrf } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new AdminError(json?.error?.message ?? "That didn’t work. Please try again.");
    return json as T;
  }
  return {
    base,
    list: () => call<AdminList>("GET", "/v1/admin/connections"),
    unlock: (code: string) => call<{ ok: true }>("POST", "/v1/admin/unlock", { code }),
    save: (id: string, values: Record<string, string | boolean>, csrf: string) => call<{ connection: AdminConnection }>("PUT", `/v1/admin/connections/${id}`, { values }, csrf),
    test: (id: string, csrf: string) => call<{ connection: AdminConnection; result: { ok: boolean; message: string } }>("POST", `/v1/admin/connections/${id}/test`, {}, csrf),
    remove: (id: string, csrf: string) => call<{ connection: AdminConnection }>("DELETE", `/v1/admin/connections/${id}`, undefined, csrf),
  };
}
