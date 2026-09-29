/* eslint-disable @typescript-eslint/no-explicit-any -- provider wire formats are untyped JSON */
// Node-only HTTP layer around the Gateway: JSON API + SSE streaming + optional static UI.
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { existsSync, readFileSync, statSync } from "node:fs";
import { extname, join, normalize, sep } from "node:path";
import { timingSafeEqual } from "node:crypto";
import type { Gateway } from "./gateway.ts";
import { sanitizeReturnTo } from "./oauth.ts";
import { ProviderError } from "./types.ts";
import type { ChatRequest, ExecutionMode } from "./types.ts";

export interface ServerOptions {
  gateway: Gateway;
  host?: string;
  port?: number;
  /** Bearer token. Required whenever the server is reachable beyond loopback. */
  token?: string;
  allowedOrigins?: string[];
  /** Directory of the static UI export to serve (optional). */
  staticDir?: string;
  maxBodyBytes?: number;
  /** Public base URL of this gateway (used for OAuth redirect URIs). Defaults to the request Host. */
  publicUrl?: string;
}

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".json": "application/json",
  ".webp": "image/webp", ".png": "image/png", ".ico": "image/x-icon", ".svg": "image/svg+xml", ".webmanifest": "application/manifest+json",
  ".txt": "text/plain", ".woff2": "font/woff2", ".map": "application/json",
};

const MODES: ExecutionMode[] = ["secure_local", "standard"];
const isLoopback = (h: string) => h === "127.0.0.1" || h === "localhost" || h === "::1";

function safeEqual(a: string, b: string) {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export function createHttpServer(opts: ServerOptions): Server {
  const host = opts.host ?? "127.0.0.1";
  if (!isLoopback(host) && !opts.token) throw new Error("A gateway token is required when binding beyond loopback.");
  const max = opts.maxBodyBytes ?? 1_000_000;
  const allowed = new Set(opts.allowedOrigins ?? []);

  function cors(req: IncomingMessage, res: ServerResponse) {
    const origin = req.headers.origin;
    if (origin && allowed.has(origin)) {
      res.setHeader("access-control-allow-origin", origin);
      res.setHeader("vary", "origin");
      res.setHeader("access-control-allow-headers", "authorization, content-type");
      res.setHeader("access-control-allow-methods", "GET, POST, DELETE, OPTIONS");
    }
  }

  function send(res: ServerResponse, status: number, body: unknown) {
    res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
    res.end(JSON.stringify(body));
  }

  async function readJson(req: IncomingMessage): Promise<any> {
    let size = 0;
    const chunks: Buffer[] = [];
    for await (const chunk of req) {
      size += (chunk as Buffer).length;
      if (size > max) throw new ProviderError("bad_request", "Request body too large.");
      chunks.push(chunk as Buffer);
    }
    if (!chunks.length) return {};
    try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { throw new ProviderError("bad_request", "Invalid JSON."); }
  }

  function authorized(req: IncomingMessage) {
    if (!opts.token) return true;
    const header = req.headers.authorization ?? "";
    return header.startsWith("Bearer ") && safeEqual(header.slice(7), opts.token);
  }

  function serveStatic(req: IncomingMessage, res: ServerResponse, pathname: string) {
    const root = opts.staticDir;
    if (!root || !existsSync(root)) { res.writeHead(404).end("Not found"); return; }
    const rel = normalize(decodeURIComponent(pathname)).replace(/^([/\\])+/, "");
    if (rel.split(sep).includes("..")) { res.writeHead(403).end("Forbidden"); return; }
    let file = join(root, rel);
    if (existsSync(file) && statSync(file).isDirectory()) file = join(file, "index.html");
    if (!existsSync(file)) { const alt = join(root, rel, "index.html"); file = existsSync(alt) ? alt : join(root, "404.html"); }
    if (!existsSync(file)) { res.writeHead(404).end("Not found"); return; }
    const type = MIME[extname(file)] ?? "application/octet-stream";
    const status = file.endsWith("404.html") && !rel.endsWith("404.html") ? 404 : 200;
    res.writeHead(status, { "content-type": type, "cache-control": file.endsWith(".html") ? "no-cache" : "public, max-age=3600" });
    res.end(readFileSync(file));
  }

  return createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://gateway.local");
    cors(req, res);
    try {
      if (req.method === "OPTIONS") { res.writeHead(204).end(); return; }

      const cb = url.pathname.match(/^\/oauth\/callback\/([a-z0-9_-]+)$/);
      if (cb && req.method === "GET") {
        // Provider redirects the browser here. Protected by single-use state + PKCE, not a bearer header.
        let target = "/settings/";
        let ok = false;
        try {
          const result = await opts.gateway.completeOAuth(cb[1], { code: url.searchParams.get("code"), state: url.searchParams.get("state"), error: url.searchParams.get("error") });
          ok = result.ok;
          target = sanitizeReturnTo(result.returnTo);
        } catch {
          res.writeHead(400, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "referrer-policy": "no-referrer" });
          res.end('<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Link expired</title><body style="font:16px system-ui;padding:24px"><h1>That link is invalid or has expired</h1><p><a href="/settings/">Back to WindSwordAI</a></p>');
          return;
        }
        const dest = new URL(target, "http://gateway.local");
        dest.searchParams.set(ok ? "connected" : "connect_error", cb[1]);
        res.writeHead(302, { location: dest.pathname + dest.search + dest.hash, "cache-control": "no-store", "referrer-policy": "no-referrer" });
        res.end();
        return;
      }

      if (!url.pathname.startsWith("/v1/")) {
        if (req.method === "GET" || req.method === "HEAD") return serveStatic(req, res, url.pathname);
        res.writeHead(405).end(); return;
      }

      // Health is unauthenticated (no data) so the UI can detect a gateway before a token is entered.
      if (url.pathname === "/v1/health" && req.method === "GET") {
        return send(res, 200, { ok: true, service: "windsword-gateway", tokenRequired: Boolean(opts.token) });
      }
      if (!authorized(req)) return send(res, 401, { error: { code: "unauthorized", message: "A valid gateway token is required." } });

      if (url.pathname === "/v1/providers" && req.method === "GET") {
        const mode = (url.searchParams.get("mode") as ExecutionMode) || "secure_local";
        if (!MODES.includes(mode)) throw new ProviderError("bad_request", "Unknown mode.");
        return send(res, 200, { mode, providers: await opts.gateway.listProviders(mode) });
      }

      const oauthStart = url.pathname.match(/^\/v1\/connections\/([a-z0-9_-]+)\/oauth\/start$/);
      if (oauthStart && req.method === "POST") {
        const body = await readJson(req);
        const redirectBase = opts.publicUrl ?? `http://${req.headers.host ?? "127.0.0.1"}`;
        return send(res, 200, { authorizeUrl: opts.gateway.beginOAuth(oauthStart[1], { returnTo: sanitizeReturnTo(body.returnTo), redirectBase }) });
      }

      const conn = url.pathname.match(/^\/v1\/connections\/([a-z0-9_-]+)$/);
      if (conn && req.method === "POST") {
        const body = await readJson(req);
        const view = await opts.gateway.connect(conn[1], { type: body.type, apiKey: body.apiKey, baseUrl: body.baseUrl, label: body.label });
        return send(res, 200, { provider: view });
      }
      if (conn && req.method === "DELETE") {
        await opts.gateway.disconnect(conn[1]);
        return send(res, 200, { ok: true });
      }

      if (url.pathname === "/v1/preflight" && req.method === "POST") {
        const body = await readJson(req);
        if (!MODES.includes(body.mode)) throw new ProviderError("bad_request", "Unknown mode.");
        return send(res, 200, { decisions: await opts.gateway.preflight({ mode: body.mode, contentClass: body.contentClass ?? "general", attachmentCount: body.attachmentCount ?? 0 }, Array.isArray(body.providers) ? body.providers : []) });
      }

      if (url.pathname === "/v1/audit" && req.method === "GET") {
        return send(res, 200, { events: opts.gateway.audit.recent(Math.min(200, Number(url.searchParams.get("limit")) || 50)) });
      }

      if (url.pathname === "/v1/chat" && req.method === "POST") {
        const body = (await readJson(req)) as ChatRequest;
        if (!body.providerId || !body.model || !Array.isArray(body.messages) || !MODES.includes(body.mode)) {
          throw new ProviderError("bad_request", "providerId, model, messages and mode are required.");
        }
        const controller = new AbortController();
        res.on("close", () => { if (!res.writableEnded) controller.abort(); });
        res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-store", connection: "keep-alive", "x-accel-buffering": "no" });
        for await (const event of opts.gateway.chat({ ...body, contentClass: body.contentClass ?? "general" }, controller.signal)) {
          if (res.destroyed) break;
          res.write(`data: ${JSON.stringify(event)}\n\n`);
        }
        res.end();
        return;
      }

      send(res, 404, { error: { code: "not_found", message: "No such endpoint." } });
    } catch (err) {
      const e = err instanceof ProviderError ? err : new ProviderError("internal", "Internal gateway error.");
      if (res.headersSent) { res.end(); return; }
      send(res, e.code === "bad_request" ? 400 : e.code === "auth_failed" ? 401 : e.code === "network" || e.code === "provider_unavailable" ? 502 : 500, { error: { code: e.code, message: e.message } });
    }
  });
}
