// Developer credential handoff: which of our canonical GitHub secrets exist, and (where a check exists) do they work?
// Prints ONLY: configured ✓ / missing ✗, and PASS / FAIL. Never a value, never part of a value.
import { runCheck } from "./check-google-credentials.mjs";

/**
 * Canonical secret names. To add one: add a line here and the same name to
 * .github/workflows/credential-status.yml (a test keeps the two in sync).
 * `check` is optional; without it we only report configured / missing.
 */
export const CREDENTIALS = [
  { name: "WINDSWORD_GOOGLE_CLIENT_SECRET", label: "Google Sign-In client secret", check: (env) => runCheck(env) },
  { name: "OPENAI_API_KEY", label: "OpenAI API key" },
  { name: "ANTHROPIC_API_KEY", label: "Anthropic API key" },
  { name: "GEMINI_API_KEY", label: "Gemini API key" },
  { name: "GOOGLE_DRIVE_CLIENT_SECRET", label: "Google Drive client secret" },
  { name: "DROPBOX_CLIENT_SECRET", label: "Dropbox client secret" },
];

export async function credentialStatus(env = process.env, list = CREDENTIALS) {
  const rows = [];
  for (const c of list) {
    const configured = Boolean((env[c.name] ?? "").trim());
    let result;
    if (configured && c.check) {
      try { const r = await c.check(env); result = r.ok ? "PASS ✓" : "FAIL ✗"; } catch { result = "FAIL ✗"; }
    }
    rows.push({ name: c.name, label: c.label, configured, result });
  }
  return rows;
}

export function formatStatus(rows) {
  return rows.map((r) => `${r.name}: ${r.configured ? "configured ✓" : "missing ✗"}${r.result ? `  |  check: ${r.result}` : ""}`).join("\n");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const rows = await credentialStatus();
  console.log(formatStatus(rows));
  process.exit(rows.some((r) => r.result?.startsWith("FAIL")) ? 1 : 0);
}
