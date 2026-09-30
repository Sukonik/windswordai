// WindSword Connect admin API: JSON endpoints behind the Settings → Connections UI.
// Existing secrets are never returned: the browser only ever sees status flags. Access is limited to the
// machine running the gateway, or (hosted) an administrator who unlocks with the admin code / an admin Google account.
import { randomBytes, timingSafeEqual } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { AuditLog } from "../audit.ts";
import { buildCookie, parseCookies, type AuthService } from "../auth.ts";
import { ConnectError, type ConnectionDefinition, type ConnectRuntime } from "./schema.ts";
import type { ConnectStore } from "./store.ts";

export interface ConnectContext {
  store: ConnectStore;
  definitions: ConnectionDefinition[];
  auth: AuthService;
  audit: AuditLog;
  env: Record<string, string | undefined>;
  fetch?: typeof fetch;
  publicUrl?: string;
  /** Extra browser origins allowed to call this API when running locally (e.g. the dev server). */
  allowedOrigins?: string[];
  /** Hosted admin access: the code from WINDSWORD_ADMIN_TOKEN, and/or signed-in Google accounts listed as admins. */
  adminToken?: string;
  adminEmails?: string[];
}

export type ConnectionStatusLabel = "connected" | "ready" | "needs_setup" | "error" | "coming_soon";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);
const LOOPBACK_ADDRS = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);
const ADMIN_COOKIE = "__Host-windsword_admin";
const ADMIN_SESSION_MS = 30 * 60_000;
const MAX_UNLOCK_FAILURES = 5;
const UNLOCK_LOCK_MS = 10 * 60_000;

/** Only reachable from this computer: loopback socket, localhost Host header, no reverse-proxy headers. */
export function isLocalAdminRequest(req: IncomingMessage, publicUrl?: string): boolean {
  if (!LOOPBACK_ADDRS.has(req.socket.remoteAddress ?? "")) return false;
  for (const h of ["x-forwarded-for", "x-forwarded-host", "x-real-ip", "forwarded", "via"]) if (req.headers[h]) return false;
  const host = String(req.headers.host ?? "").replace(/:\d+$/, "").toLowerCase();
  if (!LOCAL_HOSTS.has(host)) return false;
  if (publicUrl) {
    try { if (!LOCAL_HOSTS.has(new URL(publicUrl).hostname.toLowerCase().replace(/^(\[?::1\]?)$/, "[::1]"))) return false; } catch { return false; }
  }
  return true;
}

function isHostedRequest(req: IncomingMessage, publicUrl?: string): boolean {
  if (!publicUrl?.startsWith("https://")) return false;
  try { return String(req.headers.host ?? "").toLowerCase() === new URL(publicUrl).host.toLowerCase(); } catch { return false; }
}

function safeEqual(a: string, b: string) {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

function send(res: ServerResponse, status: number, body: unknown, headers: Record<string, string | string[]> = {}) {
  res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store", ...headers });
  res.end(JSON.stringify(body));
}

async function readJson(req: IncomingMessage, limit = 8192): Promise<Record<string, unknown>> {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > limit) throw new ConnectError("That was too large.");
    chunks.push(chunk as Buffer);
  }
  try {
    const parsed = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  } catch { throw new ConnectError("Bad request."); }
}

export function createConnectApi(ctx: ConnectContext) {
  const csrf = randomBytes(24).toString("base64url");
  const adminSessions = new Map<string, number>();
  const lastTest = new Map<string, { ok: boolean; message: string }>();
  const adminEmails = (ctx.adminEmails ?? []).map((e) => e.trim().toLowerCase()).filter(Boolean);
  const fetchImpl = ctx.fetch ?? fetch.bind(globalThis);
  const allowedOrigins = new Set(ctx.allowedOrigins ?? []);
  let failures = 0;
  let lockedUntil = 0;

  const publicOrigin = () => { try { return ctx.publicUrl ? new URL(ctx.publicUrl).origin : undefined; } catch { return undefined; } };
  const runtime = (): ConnectRuntime => ({ auth: ctx.auth, env: ctx.env, fetch: fetchImpl, publicOrigin: publicOrigin() });
  const find = (id: string) => ctx.definitions.find((d) => d.id === id);
  const hostedEnabled = Boolean(ctx.adminToken) || adminEmails.length > 0;

  async function isAdminSession(req: IncomingMessage): Promise<boolean> {
    const id = parseCookies(req.headers.cookie)[ADMIN_COOKIE];
    const exp = id ? adminSessions.get(id) : undefined;
    if (id && exp) {
      if (exp > Date.now()) return true;
      adminSessions.delete(id);
    }
    if (adminEmails.length) {
      const session = await ctx.auth.authenticate(req.headers.cookie).catch(() => undefined);
      if (session && adminEmails.includes(session.user.email.toLowerCase())) return true;
    }
    return false;
  }

  type Access = { state: "ok"; local: boolean } | { state: "locked" } | { state: "disabled"; reason: string };
  async function access(req: IncomingMessage): Promise<Access> {
    if (isLocalAdminRequest(req, ctx.publicUrl)) return { state: "ok", local: true };
    if (isHostedRequest(req, ctx.publicUrl) && hostedEnabled) return (await isAdminSession(req)) ? { state: "ok", local: false } : { state: "locked" };
    return { state: "disabled", reason: ctx.publicUrl?.startsWith("https://") ? "Set an admin code (WINDSWORD_ADMIN_TOKEN) in your hosting settings to manage connections from the browser." : "Manage connections on the computer that runs WindSwordAI, or on your hosted WindSwordAI address." };
  }

  function statusOf(def: ConnectionDefinition): ConnectionStatusLabel {
    if (def.comingSoon) return "coming_soon";
    if (def.envManaged?.(ctx.env)) return "ready";
    if (!ctx.store.status(def).configured) return "needs_setup";
    return lastTest.get(def.id)?.ok === false ? "error" : "connected";
  }

  function view(def: ConnectionDefinition) {
    const st = ctx.store.status(def);
    const origin = publicOrigin() ?? "http://localhost:8787";
    return {
      id: def.id, name: def.name, group: def.group, description: def.description,
      comingSoon: Boolean(def.comingSoon), managedByServer: def.envManaged?.(ctx.env) ?? false,
      status: statusOf(def),
      canTest: Boolean(def.test),
      // Field definitions minus anything server-side (regexes are not sent).
      fields: def.fields.map((f) => ({ name: f.name, label: f.label, type: f.type, secret: f.secret, required: Boolean(f.required), placeholder: f.placeholder, help: f.help, options: f.options })),
      // Public values only. Secrets are represented solely by `secretsSet` (booleans).
      values: st.values, secretsSet: st.secretsSet,
      advanced: { note: def.advancedNote, items: def.registerWithProvider ? def.registerWithProvider(origin) : [] },
      tryLink: st.configured ? def.tryLink : undefined,
      lastTest: lastTest.get(def.id),
    };
  }

  /** CSRF + Origin for every state-changing call. */
  function writeProblem(req: IncomingMessage, a: Extract<Access, { state: "ok" }>): string | undefined {
    const origin = req.headers.origin;
    const expected = a.local ? `http://${req.headers.host}` : publicOrigin();
    if (origin && origin !== expected && !(a.local && allowedOrigins.has(origin))) return "bad_origin";
    if (!safeEqual(String(req.headers["x-csrf-token"] ?? ""), csrf)) return "csrf";
    return undefined;
  }

  /** Returns true when the request was handled. */
  return async function handle(req: IncomingMessage, res: ServerResponse, pathname: string): Promise<boolean> {
    if (!pathname.startsWith("/v1/admin/")) return false;
    const route = pathname.slice("/v1/admin/".length).replace(/\/+$/, "");

    try {
      if (route === "unlock" && req.method === "POST") {
        const a = await access(req);
        if (a.state === "disabled") return send(res, 403, { error: { code: "admin_disabled", message: a.reason } }), true;
        if (a.state === "ok") return send(res, 200, { ok: true }), true;
        const origin = req.headers.origin;
        if (origin !== publicOrigin()) return send(res, 403, { error: { code: "bad_origin", message: "Request origin not allowed." } }), true;
        if (Date.now() < lockedUntil) return send(res, 429, { error: { code: "locked", message: "Too many wrong codes. Wait a few minutes and try again." } }), true;
        const body = await readJson(req, 2048);
        const code = typeof body.code === "string" ? body.code : "";
        if (ctx.adminToken && safeEqual(code, ctx.adminToken)) {
          failures = 0;
          const id = randomBytes(32).toString("base64url");
          adminSessions.set(id, Date.now() + ADMIN_SESSION_MS);
          return send(res, 200, { ok: true }, { "set-cookie": buildCookie(ADMIN_COOKIE, id, { maxAge: ADMIN_SESSION_MS / 1000, secure: true, sameSite: "Strict", path: "/" }) }), true;
        }
        if (++failures >= MAX_UNLOCK_FAILURES) { failures = 0; lockedUntil = Date.now() + UNLOCK_LOCK_MS; }
        return send(res, 401, { error: { code: "bad_code", message: "That code isn’t right." } }), true;
      }

      if (route === "connections" && req.method === "GET") {
        const a = await access(req);
        if (a.state === "disabled") return send(res, 200, { access: "disabled", message: a.reason }), true;
        if (a.state === "locked") return send(res, 200, { access: "locked", googleAdmin: adminEmails.length > 0 && ctx.auth.googleConfigured }), true;
        return send(res, 200, { access: "ok", csrfToken: csrf, connections: ctx.definitions.map(view) }), true;
      }

      const m = route.match(/^connections\/([a-z0-9-]+)(?:\/(test))?$/);
      if (!m) return send(res, 404, { error: { code: "not_found", message: "Not found." } }), true;
      const def = find(m[1]);
      if (!def) return send(res, 404, { error: { code: "not_found", message: "Unknown connection." } }), true;
      const a = await access(req);
      if (a.state !== "ok") return send(res, 403, { error: { code: a.state === "locked" ? "locked" : "admin_disabled", message: "Administrator access is needed." } }), true;
      const problem = writeProblem(req, a);
      if (problem) return send(res, 403, { error: { code: problem, message: problem === "csrf" ? "Please reload the page and try again." : "Request origin not allowed." } }), true;
      if (def.comingSoon || def.envManaged?.(ctx.env)) return send(res, 400, { error: { code: "read_only", message: "This connection can’t be changed here." } }), true;

      if (m[2] === "test" && req.method === "POST") {
        if (!def.test) return send(res, 400, { error: { code: "no_test", message: "This connection has no test yet." } }), true;
        const values = await ctx.store.resolve(def);
        if (!values) return send(res, 400, { error: { code: "not_set_up", message: "Save the connection first." } }), true;
        const result = await def.test(values, runtime());
        lastTest.set(def.id, result);
        ctx.audit.record({ type: "setup.connection_tested", providerId: def.id, decision: { allow: result.ok, code: result.ok ? "ok" : "failed" } });
        return send(res, 200, { connection: view(def), result }), true;
      }
      if (req.method === "PUT") {
        const body = await readJson(req);
        const raw = (body.values && typeof body.values === "object" ? body.values : {}) as Record<string, unknown>;
        const input: Record<string, string> = {};
        for (const f of def.fields) input[f.name] = typeof raw[f.name] === "string" ? (raw[f.name] as string) : f.type === "checkbox" && raw[f.name] === true ? "on" : "";
        await ctx.store.save(def, input);
        const values = await ctx.store.resolve(def);
        if (values) await def.apply?.(values, runtime());
        lastTest.delete(def.id);
        ctx.audit.record({ type: "setup.connection_saved", providerId: def.id });
        return send(res, 200, { connection: view(def) }), true;
      }
      if (req.method === "DELETE") {
        await ctx.store.remove(def);
        await def.clear?.(runtime());
        lastTest.delete(def.id);
        ctx.audit.record({ type: "setup.connection_removed", providerId: def.id });
        return send(res, 200, { connection: view(def) }), true;
      }
      return send(res, 405, { error: { code: "method", message: "Method not allowed." } }), true;
    } catch (err) {
      // Messages from ConnectError are fixed strings that never echo submitted values.
      if (err instanceof ConnectError) return send(res, 400, { error: { code: "invalid", message: err.message } }), true;
      return send(res, 500, { error: { code: "internal", message: "Something went wrong." } }), true;
    }
  };
}
