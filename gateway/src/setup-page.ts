// Local-only setup page: paste the Google client secret into a form instead of editing hidden files.
// The secret is written to the encrypted vault, never echoed back, never logged, never put in browser storage.
import { randomBytes, timingSafeEqual } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { AuditLog } from "./audit.ts";
import { googleLoginFromEnv, type AuthService } from "./auth.ts";
import type { LocalConfig } from "./local-config.ts";

export interface SetupContext {
  auth: AuthService;
  config: LocalConfig;
  audit: AuditLog;
  /** Process environment, used only to build the Google endpoints and to see what the environment already provides. */
  env: Record<string, string | undefined>;
  publicUrl?: string;
}

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);
const LOOPBACK_ADDRS = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);
const CLIENT_ID_RE = /^[0-9]+-[a-z0-9]+\.apps\.googleusercontent\.com$/i;
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** Only reachable from this computer: loopback socket, localhost Host header, and no reverse-proxy headers. */
export function isLocalSetupRequest(req: IncomingMessage, publicUrl?: string): boolean {
  if (!LOOPBACK_ADDRS.has(req.socket.remoteAddress ?? "")) return false;
  for (const h of ["x-forwarded-for", "x-forwarded-host", "x-real-ip", "forwarded", "via"]) if (req.headers[h]) return false;
  const host = String(req.headers.host ?? "").replace(/:\d+$/, "").toLowerCase();
  if (!LOCAL_HOSTS.has(host)) return false;
  if (publicUrl) {
    try { if (!LOCAL_HOSTS.has(new URL(publicUrl).hostname.toLowerCase().replace(/^(\[?::1\]?)$/, "[::1]"))) return false; } catch { return false; }
  }
  return true;
}

function safeEqual(a: string, b: string) {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

function page(res: ServerResponse, status: number, body: string, extra: Record<string, string> = {}) {
  res.writeHead(status, {
    "content-type": "text/html; charset=utf-8",
    "cache-control": "no-store",
    // same-origin (not no-referrer): browsers send `Origin: null` on form posts under no-referrer, which our Origin check rejects.
    "referrer-policy": "same-origin",
    "x-frame-options": "DENY",
    "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
    ...extra,
  });
  res.end(`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><meta name="referrer" content="same-origin"><title>WindSwordAI · Google sign-in setup</title>
<style>
body{font:16px/1.5 system-ui,sans-serif;margin:0;padding:24px 16px;background:#14161a;color:#e8eaee}
main{max-width:34rem;margin:0 auto}
h1{font-size:1.4rem;margin:0 0 .25rem}
.card{background:#1d2026;border:1px solid #2c313a;border-radius:14px;padding:18px;margin:16px 0}
label{display:block;font-weight:600;margin:14px 0 6px}
input[type=text],input[type=password]{width:100%;box-sizing:border-box;padding:12px;font-size:16px;border-radius:10px;border:1px solid #3a404b;background:#101216;color:inherit}
button{margin-top:16px;padding:12px 18px;font-size:16px;font-weight:600;border-radius:10px;border:0;background:#8ab4ff;color:#101216;cursor:pointer;min-height:44px}
button.quiet{background:transparent;color:#aab;border:1px solid #3a404b;margin-left:8px}
.ok{color:#7be0a0}.warn{color:#ffb86b}.err{color:#ff8a8a}small,.muted{color:#9aa1ad}
a{color:#8ab4ff}code{background:#101216;padding:2px 6px;border-radius:6px}
.row{display:flex;gap:8px;align-items:center;margin-top:12px}
</style><body><main>${body}</main>`);
}

function form(token: string, clientId: string, hasSecret: boolean, signInRequired: boolean) {
  return `<form method="post" action="/setup/google" autocomplete="off">
<input type="hidden" name="token" value="${esc(token)}">
<label for="cid">Google Client ID <small>(public, safe to see)</small></label>
<input id="cid" name="clientId" type="text" value="${esc(clientId)}" placeholder="123456789-abc….apps.googleusercontent.com" autocomplete="off" autocapitalize="off" spellcheck="false" required>
<label for="sec">Google Client Secret</label>
<input id="sec" name="clientSecret" type="password" placeholder="${hasSecret ? "Saved — leave empty to keep it" : "Paste it here"}" autocomplete="new-password" autocapitalize="off" spellcheck="false" data-lpignore="true" ${hasSecret ? "" : "required"}>
<div class="row"><input id="req" name="authRequired" type="checkbox" value="on" ${signInRequired || !hasSecret ? "checked" : ""}><label for="req" style="margin:0;font-weight:500">Require Google sign-in to use WindSwordAI</label></div>
<button type="submit" name="action" value="save">Save secret</button>
${hasSecret ? `<button type="submit" name="action" value="clear" class="quiet">Remove saved secret</button>` : ""}
</form>`;
}

async function readForm(req: IncomingMessage, limit = 8192): Promise<URLSearchParams> {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > limit) throw new Error("too large");
    chunks.push(chunk as Buffer);
  }
  return new URLSearchParams(Buffer.concat(chunks).toString("utf8"));
}

export function createSetupHandler(ctx: SetupContext) {
  const token = randomBytes(24).toString("base64url");
  const envSecret = Boolean(googleLoginFromEnv(ctx.env));

  async function status() {
    const storedSecret = Boolean(await ctx.config.googleClientSecret());
    return { hasSecret: envSecret || storedSecret, clientId: ctx.auth.googleClientId ?? ctx.config.googleClientId ?? ctx.env.WINDSWORD_GOOGLE_CLIENT_ID ?? "" };
  }

  function view(s: { hasSecret: boolean; clientId: string }, message = "") {
    const on = ctx.auth.mode === "required";
    return `<h1>Google sign-in setup</h1><p class="muted">This page only works on this computer. The secret is stored encrypted on this machine, shown nowhere, and never sent to GitHub or the browser.</p>
${message}
<div class="card">
<p><strong>Client ID:</strong> ${s.clientId ? `<span class="ok">✓ ${esc(s.clientId.slice(0, 12))}…</span>` : `<span class="warn">not set</span>`}<br>
<strong>Client Secret:</strong> ${s.hasSecret ? `<span class="ok">✓ saved (hidden)</span>` : `<span class="warn">not set</span>`}<br>
<strong>Sign-in:</strong> ${on ? `<span class="ok">required</span>` : `<span class="muted">off</span>`}</p>
${envSecret ? `<p class="muted">The secret is provided by the server environment (<code>WINDSWORD_GOOGLE_CLIENT_SECRET</code>), so there is nothing to paste.</p>` : form(token, s.clientId, s.hasSecret, on)}
</div>
${s.hasSecret && ctx.auth.googleConfigured ? `<p><a href="/chat/">Open WindSwordAI</a> and click <strong>Continue with Google</strong> to test it.</p>` : ""}`;
  }

  return async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (!isLocalSetupRequest(req, ctx.publicUrl)) return page(res, 403, `<h1>Setup is local only</h1><p>Open this page on the computer running WindSwordAI, at <code>http://localhost:8787/setup/google</code>. On a hosted server, add the secret in your hosting provider’s Secrets settings instead.</p>`);
    if (req.method === "GET") {
      const q = new URL(req.url ?? "/", "http://x").searchParams;
      const message = q.get("saved") ? `<p class="ok">✓ Saved. Now tell Claude “secret added”.</p>` : q.get("cleared") ? `<p class="ok">✓ Removed.</p>` : "";
      return page(res, 200, view(await status(), message));
    }
    if (req.method !== "POST") return void res.writeHead(405).end();

    const problem = (text: string) => async () => page(res, 400, view(await status(), `<p class="err" role="alert">${text}</p>`));
    const origin = req.headers.origin;
    if (origin && origin !== `http://${req.headers.host}`) return page(res, 403, `<h1>Blocked</h1><p>That request came from a different site.</p>`);
    let f: URLSearchParams;
    try { f = await readForm(req); } catch { return problem("That was too large to be a secret.")(); }
    if (!safeEqual(f.get("token") ?? "", token)) return page(res, 403, `<h1>Please reload</h1><p>This form expired. <a href="/setup/google">Reload the setup page</a> and try again.</p>`);
    if (envSecret) return problem("The secret comes from the server environment and can’t be changed here.")();

    if (f.get("action") === "clear") {
      await ctx.config.clearGoogle();
      ctx.auth.setGoogle(undefined);
      ctx.auth.setMode("off");
      ctx.audit.record({ type: "setup.google_cleared" });
      res.writeHead(303, { location: "/setup/google?cleared=1", "cache-control": "no-store" }).end();
      return;
    }

    const clientId = (f.get("clientId") ?? "").trim();
    const secret = (f.get("clientSecret") ?? "").trim();
    if (!CLIENT_ID_RE.test(clientId)) return problem("That doesn’t look like a Google Client ID. It ends in <code>.apps.googleusercontent.com</code>.")();
    const existing = await ctx.config.googleClientSecret();
    if (!secret && !existing) return problem("Paste the Client Secret first.")();
    if (secret && (secret.length < 8 || secret.length > 256 || /[\s\u0000-\u001f<>"']/.test(secret))) return problem("That doesn’t look like a Client Secret. Copy it again from Google, with nothing extra.")();

    const authRequired = f.get("authRequired") === "on";
    await ctx.config.saveGoogle({ clientId, clientSecret: secret || undefined, authRequired });
    const google = googleLoginFromEnv({ ...ctx.env, WINDSWORD_GOOGLE_CLIENT_ID: clientId, WINDSWORD_GOOGLE_CLIENT_SECRET: secret || existing });
    ctx.auth.setGoogle(google);
    ctx.auth.setMode(authRequired ? "required" : "off");
    ctx.audit.record({ type: "setup.google_saved" });
    res.writeHead(303, { location: "/setup/google?saved=1", "cache-control": "no-store" }).end();
  };
}
