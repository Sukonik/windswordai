// Run: npm run gateway   (Node 22+, no dependencies)
import { randomBytes } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync } from "node:fs";
import { networkInterfaces } from "node:os";
import { join, resolve } from "node:path";
import { AuditLog } from "./src/audit.ts";
import { AuthService, FileSessionStore, FileUserStore, googleLoginFromEnv } from "./src/auth.ts";
import { Gateway } from "./src/gateway.ts";
import { createHttpServer } from "./src/http.ts";
import { OAuthManager, oauthConfigsFromEnv } from "./src/oauth.ts";
import { createDefaultRegistry } from "./src/providers/index.ts";
import { FileConnectionStore, FileSecretStore, loadVaultKey } from "./src/vault.ts";

// Local secrets live in a git-ignored .env (never .env.example). Existing environment variables win.
if (existsSync(".env")) {
  try { process.loadEnvFile(".env"); } catch { console.error("Could not read .env (check its format). Continuing with the process environment."); }
}

const env = process.env;
const host = env.WINDSWORD_HOST ?? "127.0.0.1";
const port = Number(env.WINDSWORD_PORT ?? 8787);
const stateDir = resolve(env.WINDSWORD_STATE_DIR ?? ".windsword");
const loopback = host === "127.0.0.1" || host === "localhost" || host === "::1";
const authMode = (env.WINDSWORD_AUTH ?? "off").toLowerCase();
if (authMode !== "off" && authMode !== "required") {
  console.error(`WINDSWORD_AUTH must be "off" or "required" (got "${authMode}").`);
  process.exit(1);
}
const google = googleLoginFromEnv(env);
if (authMode === "required" && !google) {
  console.error("WINDSWORD_AUTH=required needs WINDSWORD_GOOGLE_CLIENT_ID and WINDSWORD_GOOGLE_CLIENT_SECRET.\nSet them in your environment or in a local .env file. Never commit them.");
  process.exit(1);
}
// With sign-in required the session cookie is the credential; a bearer token is only auto-generated otherwise.
const token = env.WINDSWORD_GATEWAY_TOKEN || (loopback || authMode === "required" ? undefined : randomBytes(18).toString("base64url"));

mkdirSync(stateDir, { recursive: true, mode: 0o700 });
const auditFile = join(stateDir, "audit.jsonl");
const audit = new AuditLog((line) => appendFileSync(auditFile, line + "\n", { mode: 0o600 }));
const secureCookies = Boolean(env.WINDSWORD_PUBLIC_URL?.startsWith("https://"));
const auth = authMode === "required"
  ? new AuthService({
      mode: "required",
      google,
      users: new FileUserStore(stateDir),
      sessions: new FileSessionStore(stateDir),
      allowedEmails: (env.WINDSWORD_AUTH_ALLOWED_EMAILS ?? "").split(","),
      sessionTtlMs: Number(env.WINDSWORD_SESSION_TTL_HOURS ?? 168) * 3_600_000,
      secureCookies,
      audit,
    })
  : undefined;

const registry = createDefaultRegistry();
const oauthConfigs = oauthConfigsFromEnv(env, registry.list().map((a) => a.descriptor.id));

const gateway = new Gateway({
  registry,
  oauth: new OAuthManager({ configs: oauthConfigs }),
  secrets: new FileSecretStore(stateDir, loadVaultKey(stateDir)),
  connections: new FileConnectionStore(stateDir),
  audit,
  probeLocal: true,
  approvedForProtected: new Set((env.WINDSWORD_APPROVED_FOR_PROTECTED ?? "").split(",").map((s) => s.trim()).filter(Boolean)),
});

if (auth) {
  // Environment API keys are one shared identity; they must never silently serve every signed-in user.
  console.log("  (environment API keys are ignored while sign-in is required; each user connects their own)");
} else {
  for (const r of await gateway.connectFromEnv(env)) console.log(`  ${r.ok ? "✓" : "✗"} ${r.providerId}: ${r.message}`);
}

const staticDir = resolve(env.WINDSWORD_STATIC_DIR ?? "out");
const origins = (env.WINDSWORD_ALLOWED_ORIGINS ?? "http://localhost:3000,http://127.0.0.1:3000,http://localhost:8787,http://127.0.0.1:8787").split(",").map((s) => s.trim());

const server = createHttpServer({ gateway, auth, host, port, token, allowedOrigins: origins, publicUrl: env.WINDSWORD_PUBLIC_URL, staticDir: existsSync(staticDir) ? staticDir : undefined });
server.listen(port, host, () => {
  console.log(`\nWindSwordAI gateway listening on http://${host}:${port}`);
  if (host === "0.0.0.0" || host === "::") {
    const lan = Object.values(networkInterfaces()).flat().filter((n) => n && n.family === "IPv4" && !n.internal).map((n) => `http://${n!.address}:${port}`);
    console.log(`  on your network: ${lan.length ? lan.join("   ") : "(no LAN address found)"}   <- open this on your phone`);
    console.log("  Windows may ask to allow Node.js through the firewall the first time: allow it on Private networks.");
  }
  console.log(`  state dir : ${stateDir}  (encrypted vault, connections, audit.jsonl)`);
  if (process.platform === "win32" && !env.WINDSWORD_VAULT_KEY) {
    console.log("  note      : on Windows the vault key file is not permission-protected. For stronger protection set WINDSWORD_VAULT_KEY\n              (32 random bytes, base64) in your environment so the key is not stored next to the vault.");
  }
  console.log(`  UI        : ${existsSync(staticDir) ? `served from ${staticDir}` : "not built (run `npm run build:local` first, or use `npm run dev`)"}`);
  console.log(`  account linking (OAuth): ${Object.keys(oauthConfigs).length ? Object.keys(oauthConfigs).join(", ") : "none configured (developer keys only)"}`);
  if (google) {
    console.log(`  sign-in   : Google ${auth ? "REQUIRED" : "credentials found but WINDSWORD_AUTH is off (sign-in disabled)"} (client id ${google.clientId.slice(0, 12)}…, secret set: yes)`);
    console.log(`              scopes: openid email profile · redirect URI: ${(env.WINDSWORD_PUBLIC_URL ?? `http://localhost:${port}`).replace(/\/+$/, "")}/oauth/callback/google`);
    if (auth && !secureCookies && !loopback) console.log("  WARNING   : sign-in over plain http beyond localhost. Set WINDSWORD_PUBLIC_URL to your https origin.");
  } else if (authMode === "off") {
    console.log("  sign-in   : off (single-user local mode)");
  }
  console.log(`  token     : ${token ? token : "not required on loopback"}`);
  console.log(`  default mode is Secure Local: cloud providers stay blocked until you switch to Standard in the UI.\n`);
});
