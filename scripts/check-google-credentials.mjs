// Checks the Google Sign-In client credentials WITHOUT ever showing them.
// Prints only: configured / missing, and pass / fail with a fixed plain-words reason.
// Used by the "Google credential check" GitHub Action; also runnable locally.
import { googleLogin } from "../gateway/src/connect/definitions.ts";

/** Public OAuth client id for the WindSwordAI Google project (safe to keep in the repo). */
export const DEFAULT_CLIENT_ID = "485500838676-n6mluvqbplk39en025a6ujo9dh8j4lsn.apps.googleusercontent.com";

export async function runCheck(env, fetchImpl = fetch) {
  const clientId = (env.WINDSWORD_GOOGLE_CLIENT_ID || DEFAULT_CLIENT_ID).trim();
  const secret = (env.WINDSWORD_GOOGLE_CLIENT_SECRET || "").trim();
  if (!secret) return { configured: false, ok: false, message: "No Client Secret found. Add the repository secret WINDSWORD_GOOGLE_CLIENT_SECRET." };
  const result = await googleLogin.test({ clientId, clientSecret: secret }, { env, fetch: fetchImpl, publicOrigin: env.WINDSWORD_PUBLIC_URL || undefined });
  // The message comes from fixed strings in the Google definition and never includes the secret.
  return { configured: true, ok: result.ok, message: result.message };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const r = await runCheck(process.env);
  console.log(`WINDSWORD_GOOGLE_CLIENT_SECRET: ${r.configured ? "configured ✓" : "missing ✗"}`);
  if (r.configured) console.log(`Google check: ${r.ok ? "PASS ✓" : "FAIL ✗"} - ${r.message}`);
  else console.log(r.message);
  process.exit(r.ok ? 0 : 1);
}
