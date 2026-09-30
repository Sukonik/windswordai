"use client";

import { useGateway } from "@/components/GatewayProvider";

/** Settings → Authentication → Google. The secret is entered on the gateway's own page, never in this app's JavaScript. */
export function AuthSettingsCard() {
  const { status } = useGateway();
  if (!("url" in status) || !status.url) return null;
  const href = `${status.url.replace(/\/+$/, "")}/setup/google`;
  return (
    <section className="card" aria-labelledby="auth-settings-title" style={{ margin: "16px auto", maxWidth: "48rem", padding: "0 16px" }}>
      <h2 id="auth-settings-title">Authentication</h2>
      <p>Set up “Continue with Google” for WindSwordAI. You’ll paste the Google Client ID and Client Secret on a secure page served by the gateway. The secret is stored encrypted on the server and never shown again.</p>
      <a className="btn btn--primary" href={href}>Set up Google sign-in</a>
    </section>
  );
}
