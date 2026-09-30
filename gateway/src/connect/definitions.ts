import { googleLoginFromEnv } from "../auth.ts";
import type { ConnectionDefinition } from "./schema.ts";

export const GOOGLE_CLIENT_ID_RE = /^[0-9]+-[a-z0-9]+\.apps\.googleusercontent\.com$/i;

/** Google Sign-In: identity only (openid email profile). First adapter of WindSword Connect. */
export const googleLogin: ConnectionDefinition = {
  id: "google-login",
  name: "Google Sign-In",
  group: "Identity",
  description: "Let people sign in to WindSwordAI with their Google account. Only name and email are used; no Drive or Gemini access.",
  fields: [
    { name: "clientId", label: "Client ID", type: "text", secret: false, required: true, placeholder: "123456789-abc….apps.googleusercontent.com", pattern: GOOGLE_CLIENT_ID_RE, patternMessage: "That doesn’t look like a Google Client ID. It ends in .apps.googleusercontent.com.", help: "Public. Safe to see." },
    { name: "clientSecret", label: "Client Secret", type: "password", secret: true, required: true, minLength: 8, maxLength: 256, help: "Private. Stored encrypted on the server and never shown again." },
    { name: "requireSignIn", label: "Require Google sign-in to use WindSwordAI", type: "checkbox", secret: false },
  ],
  envManaged: (env) => Boolean(googleLoginFromEnv(env)),
  registerWithProvider: (origin) => [
    { label: "Allowed website address (JavaScript origin)", value: origin },
    { label: "Allowed return address (redirect URI)", value: `${origin}/oauth/callback/google` },
  ],
  tryLink: { href: "/auth/google/start?returnTo=%2Fsettings%2F%23connections", label: "Try Google sign-in" },
  advancedNote: "Register these two addresses on your Google OAuth client (Google Cloud Console → Credentials).",
  apply(values, rt) {
    rt.auth.setGoogle(googleLoginFromEnv({ ...rt.env, WINDSWORD_GOOGLE_CLIENT_ID: String(values.clientId), WINDSWORD_GOOGLE_CLIENT_SECRET: String(values.clientSecret) }));
    rt.auth.setMode(values.requireSignIn ? "required" : "off");
  },
  clear(rt) {
    rt.auth.setGoogle(undefined);
    rt.auth.setMode("off");
  },
  /**
   * Send Google a deliberately fake authorization code with the saved credentials.
   * "invalid_grant" means Google accepted the client id + secret and rejected only the fake code.
   */
  async test(values, rt) {
    const cfg = googleLoginFromEnv({ ...rt.env, WINDSWORD_GOOGLE_CLIENT_ID: String(values.clientId), WINDSWORD_GOOGLE_CLIENT_SECRET: String(values.clientSecret) });
    if (!cfg) return { ok: false, message: "Not fully set up yet." };
    try {
      const res = await rt.fetch(cfg.tokenUrl, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ grant_type: "authorization_code", code: "windsword-connection-test", redirect_uri: `${rt.publicOrigin ?? "http://localhost:8787"}/oauth/callback/google`, client_id: cfg.clientId, client_secret: cfg.clientSecret }),
        signal: AbortSignal.timeout(10_000),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (body.error === "invalid_grant") return { ok: true, message: "Google accepted the Client ID and Secret." };
      if (body.error === "invalid_client" || body.error === "unauthorized_client") return { ok: false, message: "Google didn’t accept this Client ID / Secret pair. Check both were copied from the same OAuth client." };
      return { ok: false, message: "Google gave an unexpected answer. Try again in a moment." };
    } catch {
      return { ok: false, message: "Couldn’t reach Google from the server." };
    }
  },
};

const soon = (id: string, name: string, group: ConnectionDefinition["group"], description: string): ConnectionDefinition => ({ id, name, group, description, fields: [], comingSoon: true });

/** Every connection WindSword Connect knows about. Add a definition here to get a setup page for it. */
export const CONNECTIONS: ConnectionDefinition[] = [
  googleLogin,
  soon("google-drive", "Google Drive", "Storage", "Keep files in your own Google Drive. Set up separately from sign-in."),
  soon("dropbox", "Dropbox", "Storage", "Keep files in your own Dropbox."),
  soon("s3-r2", "S3 / R2", "Storage", "Keep files in an S3-compatible bucket or Cloudflare R2."),
];
