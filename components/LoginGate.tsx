"use client";

import { usePathname } from "next/navigation";
import { useSyncExternalStore } from "react";
import { BrandMark } from "@/components/BrandMark";

const messages: Record<string, string> = {
  denied: "Sign-in was cancelled.",
  expired: "That sign-in link expired. Please try again.",
  not_allowed: "This Google account isn’t on the access list yet. Ask the WindSwordAI owner to add it.",
  unverified: "Your Google email address isn’t verified, so it can’t be used to sign in.",
  failed: "Sign-in didn’t complete. Please try again.",
};

const subscribe = () => () => {};
const readSearch = () => window.location.search;

/** Shown instead of the app when a hosted gateway requires sign-in. Identity only: no Drive or Gemini access. */
export function LoginGate({ url, googleConfigured }: { url: string; googleConfigured: boolean }) {
  const pathname = usePathname();
  const search = useSyncExternalStore(subscribe, readSearch, () => "");
  const code = new URLSearchParams(search).get("login_error");
  const returnTo = pathname && pathname !== "/" ? pathname : "/chat/";
  const href = `${url.replace(/\/+$/, "")}/auth/google/start?returnTo=${encodeURIComponent(returnTo)}`;

  return (
    <section className="login-gate" aria-labelledby="login-title">
      <BrandMark variant="sapphire-sm" className="login-gate__mark" />
      <h1 id="login-title">Sign in to WindSwordAI</h1>
      <p>
        Use your Google account to sign in. WindSwordAI only asks for your name and email so it knows who you are.
        It does not get access to your Google Drive or to Gemini; those are separate connections you choose later.
      </p>
      {code && <p className="form-error" role="alert">{messages[code] ?? messages.failed}</p>}
      {googleConfigured ? (
        <a className="btn btn--primary btn--large" href={href}>Continue with Google</a>
      ) : (
        <p className="sheet__note">
          Sign-in isn’t set up yet. On the computer running WindSwordAI, open{" "}
          <a href={`${url.replace(/\/+$/, "")}/setup/google`}>the local setup page</a> and paste your Google Client Secret.
        </p>
      )}
      <p className="login-gate__fine">You’ll go to Google’s own page to sign in, then come straight back.</p>
    </section>
  );
}
