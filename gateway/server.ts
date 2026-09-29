// Run: npm run gateway   (Node 22+, no dependencies)
import { randomBytes } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { AuditLog } from "./src/audit.ts";
import { Gateway } from "./src/gateway.ts";
import { createHttpServer } from "./src/http.ts";
import { createDefaultRegistry } from "./src/providers/index.ts";
import { FileConnectionStore, FileSecretStore, loadVaultKey } from "./src/vault.ts";

const env = process.env;
const host = env.WINDSWORD_HOST ?? "127.0.0.1";
const port = Number(env.WINDSWORD_PORT ?? 8787);
const stateDir = resolve(env.WINDSWORD_STATE_DIR ?? ".windsword");
const loopback = host === "127.0.0.1" || host === "localhost" || host === "::1";
const token = env.WINDSWORD_GATEWAY_TOKEN || (loopback ? undefined : randomBytes(18).toString("base64url"));

mkdirSync(stateDir, { recursive: true, mode: 0o700 });
const auditFile = join(stateDir, "audit.jsonl");
const audit = new AuditLog((line) => appendFileSync(auditFile, line + "\n", { mode: 0o600 }));

const gateway = new Gateway({
  registry: createDefaultRegistry(),
  secrets: new FileSecretStore(stateDir, loadVaultKey(stateDir)),
  connections: new FileConnectionStore(stateDir),
  audit,
  probeLocal: true,
  approvedForProtected: new Set((env.WINDSWORD_APPROVED_FOR_PROTECTED ?? "").split(",").map((s) => s.trim()).filter(Boolean)),
});

for (const r of await gateway.connectFromEnv(env)) console.log(`  ${r.ok ? "✓" : "✗"} ${r.providerId}: ${r.message}`);

const staticDir = resolve(env.WINDSWORD_STATIC_DIR ?? "out");
const origins = (env.WINDSWORD_ALLOWED_ORIGINS ?? "http://localhost:3000,http://127.0.0.1:3000,http://localhost:8787,http://127.0.0.1:8787").split(",").map((s) => s.trim());

const server = createHttpServer({ gateway, host, port, token, allowedOrigins: origins, staticDir: existsSync(staticDir) ? staticDir : undefined });
server.listen(port, host, () => {
  console.log(`\nWindSwordAI gateway listening on http://${host}:${port}`);
  console.log(`  state dir : ${stateDir}  (encrypted vault, connections, audit.jsonl)`);
  console.log(`  UI        : ${existsSync(staticDir) ? `served from ${staticDir}` : "not built (run `npm run build:local` first, or use `npm run dev`)"}`);
  console.log(`  token     : ${token ? token : "not required on loopback"}`);
  console.log(`  default mode is Secure Local: cloud providers stay blocked until you switch to Standard in the UI.\n`);
});
