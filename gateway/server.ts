// Run: npm run gateway   (Node 22+, no dependencies)
import { randomBytes } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync } from "node:fs";
import { networkInterfaces } from "node:os";
import { join, resolve } from "node:path";
import { AuditLog } from "./src/audit.ts";
import { AuthService, FileSessionStore, FileUserStore, googleLoginFromEnv } from "./src/auth.ts";
import { Gateway } from "./src/gateway.ts";
import { createHttpServer } from "./src/http.ts";
import { CONNECTIONS, googleLogin } from "./src/connect/definitions.ts";
import { createConnectApi } from "./src/connect/api.ts";
import { ConnectStore } from "./src/connect/store.ts";
import { OAuthManager, oauthConfigsFromEnv } from "./src/oauth.ts";
import { createDefaultRegistry } from "./src/providers/index.ts";
import { CachedStateIO, FileStateIO, StorageError, SupabaseBackend, type StateIO } from "./src/state.ts";
import { FileConnectionStore, FileSecretStore, loadVaultKey } from "./src/vault.ts";

// Local secrets live in a git-ignored .env (never .env.example). Existing environment variables win.
if (existsSync(".env")) {
  try { process.loadEnvFile(".env"); } catch { console.error("Could not read .env (check its format). Continuing with the process environment."); }
}

const env = process.env;
const host = env.WINDSWORD_HOST ?? "127.0.0.1";
const port = Number(env.WINDSWORD_PORT ?? env.PORT ?? 8787); // PORT is what most hosting providers inject
const stateDir = resolve(env.WINDSWORD_STATE_DIR ?? ".windsword");
// Hosts like Render inject their public https address; use it unless one is set explicitly.
const publicUrl = env.WINDSWORD_PUBLIC_URL || env.RENDER_EXTERNAL_URL || undefined;
const loopback = host === "127.0.0.1" || host === "localhost" || host === "::1";

// Storage: Supabase when configured (for hosts whose disk is not permanent, e.g. Render Free), otherwise files in the state dir.
let state: StateIO;
let vaultKey: Buffer;
if (env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY) {
  if (!env.WINDSWORD_VAULT_KEY) {
    // The key must survive restarts too, and a key file on a temporary disk would not.
    console.error("Supabase storage needs WINDSWORD_VAULT_KEY (32 random bytes, base64) so saved secrets can be decrypted after a restart.");
    process.exit(1);
  }
  try {
    state = await CachedStateIO.open(new SupabaseBackend({ url: env.SUPABASE_URL, key: env.SUPABASE_SERVICE_ROLE_KEY }));
  } catch (err) {
    console.error(err instanceof StorageError ? err.message : "Could not open Supabase storage.");
    process.exit(1);
  }
  vaultKey = loadVaultKey(stateDir);
} else {
  mkdirSync(stateDir, { recursive: true, mode: 0o700 });
  state = new FileStateIO(stateDir);
  vaultKey = loadVaultKey(stateDir);
}
const secrets = new FileSecretStore(state, vaultKey);
// Values entered on the local setup page (/setup) live in the encrypted vault; environment variables win.
const connectStore = new ConnectStore(state, secrets);
const savedGoogle = await connectStore.resolve(googleLogin);
const authMode = (env.WINDSWORD_AUTH || (savedGoogle?.requireSignIn ? "required" : "off")).toLowerCase();
if (authMode !== "off" && authMode !== "required") {
  console.error(`WINDSWORD_AUTH must be "off" or "required" (got "${authMode}").`);
  process.exit(1);
}
const google = googleLoginFromEnv(env) ?? (savedGoogle ? googleLoginFromEnv({ ...env, WINDSWORD_GOOGLE_CLIENT_ID: String(savedGoogle.clientId), WINDSWORD_GOOGLE_CLIENT_SECRET: String(savedGoogle.clientSecret) }) : undefined);
// With sign-in required the session cookie is the credential; a bearer token is only auto-generated otherwise.
const token = env.WINDSWORD_GATEWAY_TOKEN || (loopback || authMode === "required" ? undefined : randomBytes(18).toString("base64url"));

// Audit lines never contain secrets, prompts or emails. On Supabase hosting the disk is temporary, so they go to the host's logs.
const auditFile = join(stateDir, "audit.jsonl");
const audit = new AuditLog(state.kind === "supabase" ? (line) => console.log(`audit ${line}`) : (line) => appendFileSync(auditFile, line + "\n", { mode: 0o600 }));
const secureCookies = Boolean(publicUrl?.startsWith("https://"));
// Always created so sign-in can be switched on from the local setup page without a restart.
const auth = new AuthService({
  mode: authMode,
  google,
  users: new FileUserStore(state),
  sessions: new FileSessionStore(state),
  allowedEmails: (env.WINDSWORD_AUTH_ALLOWED_EMAILS ?? "").split(","),
  sessionTtlMs: Number(env.WINDSWORD_SESSION_TTL_HOURS ?? 168) * 3_600_000,
  secureCookies,
  audit,
});
const connect = createConnectApi({
  store: connectStore, definitions: CONNECTIONS, auth, audit, env, publicUrl,
  allowedOrigins: (env.WINDSWORD_ALLOWED_ORIGINS ?? "http://localhost:3000,http://127.0.0.1:3000").split(",").map((o) => o.trim()),
  adminToken: env.WINDSWORD_ADMIN_TOKEN || undefined,
  adminEmails: (env.WINDSWORD_ADMIN_EMAILS ?? "").split(","),
});

const registry = createDefaultRegistry();
const oauthConfigs = oauthConfigsFromEnv(env, registry.list().map((a) => a.descriptor.id));

const gateway = new Gateway({
  registry,
  oauth: new OAuthManager({ configs: oauthConfigs }),
  secrets,
  connections: new FileConnectionStore(state),
  audit,
  probeLocal: true,
  approvedForProtected: new Set((env.WINDSWORD_APPROVED_FOR_PROTECTED ?? "").split(",").map((s) => s.trim()).filter(Boolean)),
});

if (authMode === "required") {
  // Environment API keys are one shared identity; they must never silently serve every signed-in user.
  console.log("  (environment API keys are ignored while sign-in is required; each user connects their own)");
} else {
  for (const r of await gateway.connectFromEnv(env)) console.log(`  ${r.ok ? "✓" : "✗"} ${r.providerId}: ${r.message}`);
}

const staticDir = resolve(env.WINDSWORD_STATIC_DIR ?? "out");
const origins = (env.WINDSWORD_ALLOWED_ORIGINS ?? "http://localhost:3000,http://127.0.0.1:3000,http://localhost:8787,http://127.0.0.1:8787").split(",").map((s) => s.trim());

const server = createHttpServer({ gateway, auth, connect, storage: state.kind, host, port, token, allowedOrigins: origins, publicUrl, staticDir: existsSync(staticDir) ? staticDir : undefined });
server.listen(port, host, () => {
  console.log(`\nWindSwordAI gateway listening on http://${host}:${port}`);
  if (host === "0.0.0.0" || host === "::") {
    const lan = Object.values(networkInterfaces()).flat().filter((n) => n && n.family === "IPv4" && !n.internal).map((n) => `http://${n!.address}:${port}`);
    console.log(`  on your network: ${lan.length ? lan.join("   ") : "(no LAN address found)"}   <- open this on your phone`);
    console.log("  Windows may ask to allow Node.js through the firewall the first time: allow it on Private networks.");
  }
  console.log(state.kind === "supabase" ? "  storage   : Supabase (encrypted vault, connections, sessions). Audit lines go to the host logs." : `  state dir : ${stateDir}  (encrypted vault, connections, audit.jsonl)`);
  if (process.platform === "win32" && !env.WINDSWORD_VAULT_KEY) {
    console.log("  note      : on Windows the vault key file is not permission-protected. For stronger protection set WINDSWORD_VAULT_KEY\n              (32 random bytes, base64) in your environment so the key is not stored next to the vault.");
  }
  console.log(`  UI        : ${existsSync(staticDir) ? `served from ${staticDir}` : "not built (run `npm run build:local` first, or use `npm run dev`)"}`);
  console.log(`  account linking (OAuth): ${Object.keys(oauthConfigs).length ? Object.keys(oauthConfigs).join(", ") : "none configured (developer keys only)"}`);
  if (google) {
    console.log(`  sign-in   : Google ${authMode === "required" ? "REQUIRED" : "credentials found but sign-in is off"} (client id ${google.clientId.slice(0, 12)}…, secret set: yes)`);
    console.log(`              scopes: openid email profile · redirect URI: ${(publicUrl ?? `http://localhost:${port}`).replace(/\/+$/, "")}/oauth/callback/google`);
    if (authMode === "required" && !secureCookies && !loopback) console.log("  WARNING   : sign-in over plain http beyond localhost. Set WINDSWORD_PUBLIC_URL to your https origin.");
  } else if (authMode === "required") {
    console.log(`  sign-in   : REQUIRED but Google is not set up yet -> open http://localhost:${port}/settings/#connections on this computer`);
  } else {
    console.log(`  sign-in   : off (single-user local mode). To enable Google sign-in: open Settings → Connections at http://localhost:${port}/settings/`);
  }
  if (env.WINDSWORD_ADMIN_TOKEN) {
    console.log(`  admin     : browser setup enabled at ${(publicUrl ?? "(set WINDSWORD_PUBLIC_URL to your https address)").replace(/\/+$/, "")}/settings/ → Connections (admin code set: yes)`);
  }
  console.log(`  token     : ${token ? token : "not required on loopback"}`);
  console.log(`  default mode is Secure Local: cloud providers stay blocked until you switch to Standard in the UI.\n`);
});
