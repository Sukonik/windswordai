"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import { useGateway } from "@/components/GatewayProvider";
import { Icon } from "@/components/Icon";
import { ProviderMark } from "@/components/ProviderMark";
import { providerUi } from "@/lib/gateway/provider-ui";
import type { ProviderView } from "@/gateway/src/types";

export interface ConnectRequest {
  providerId: string;
  /** Where the browser should land after a provider authorization redirect. Defaults to the current page. */
  returnTo?: string;
  onConnected?: (view: ProviderView) => void;
  /** Called right before the browser leaves for the provider (e.g. to save the conversation). */
  onBeforeRedirect?: () => void;
}

interface ConnectContextValue {
  open: (request: ConnectRequest) => void;
  notify: (text: string) => void;
}

const ConnectContext = createContext<ConnectContextValue | null>(null);

export function useConnect() {
  const ctx = useContext(ConnectContext);
  if (!ctx) throw new Error("useConnect must be used inside <ConnectProvider>");
  return ctx;
}

export function ConnectProvider({ children }: { children: ReactNode }) {
  const [request, setRequest] = useState<ConnectRequest>();
  const [toast, setToast] = useState<string>();
  const timer = useRef<number | undefined>(undefined);

  const notify = useCallback((text: string) => {
    setToast(text);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setToast(undefined), 5000);
  }, []);

  const value = useMemo(() => ({ open: setRequest, notify }), [notify]);

  return (
    <ConnectContext.Provider value={value}>
      {children}
      {request && <ConnectSheet request={request} onClose={() => setRequest(undefined)} notify={notify} />}
      {toast && <div className="toast" role="status">{toast}</div>}
    </ConnectContext.Provider>
  );
}

function ConnectSheet({ request, onClose, notify }: { request: ConnectRequest; onClose: () => void; notify: (t: string) => void }) {
  const { transport, status, providers, refresh } = useGateway();
  const view = providers.find((p) => p.descriptor.id === request.providerId);
  const d = view?.descriptor;
  const ui = providerUi(request.providerId, d?.displayName);
  const demo = transport.kind === "demo";
  const local = d?.kind === "local";
  const apiMethod = d?.authMethods.find((m) => m.type === "api_key" && m.status === "available");
  const oauthReady = Boolean(view?.oauth.available);

  const [showKey, setShowKey] = useState(false);
  const [apiKey, setApiKey] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const dialogRef = useRef<HTMLDivElement>(null);
  const keyVisible = showKey || !oauthReady;

  // Focus management + Escape + background scroll lock while the sheet is open.
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    document.body.dataset.sheetOpen = "true";
    const first = dialogRef.current?.querySelector<HTMLElement>("input, button.btn--primary, button");
    (first ?? dialogRef.current)?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
      if (event.key === "Tab" && dialogRef.current) {
        const items = [...dialogRef.current.querySelectorAll<HTMLElement>("a[href], button:not([disabled]), input:not([disabled])")];
        if (!items.length) return;
        const firstEl = items[0];
        const last = items[items.length - 1];
        if (event.shiftKey && document.activeElement === firstEl) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); firstEl.focus(); }
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      delete document.body.dataset.sheetOpen;
      previous?.focus?.();
    };
  }, [onClose]);

  async function continueWithProvider() {
    setBusy(true);
    setError(undefined);
    try {
      const returnTo = request.returnTo ?? window.location.pathname + window.location.search;
      const url = await transport.startOAuth(request.providerId, returnTo);
      request.onBeforeRedirect?.();
      window.location.assign(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start the connection.");
      setBusy(false);
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(undefined);
    try {
      const connected = await transport.connect(request.providerId, local ? { type: "local", baseUrl: baseUrl.trim() || undefined } : { type: "api_key", apiKey, baseUrl: baseUrl.trim() || undefined });
      setApiKey(""); // never kept in UI state after submission
      await refresh();
      notify(local ? `${ui.name} detected on this computer.` : `${ui.name} connected.`);
      request.onConnected?.(connected);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not connect.");
      setBusy(false);
    }
  }

  return (
    <div className="sheet-scrim" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div className="sheet" role="dialog" aria-modal="true" aria-labelledby="connect-title" ref={dialogRef} tabIndex={-1}>
        <div className="sheet__head">
          <ProviderMark id={request.providerId} displayName={d?.displayName} size={44} />
          <div>
            <h2 id="connect-title">{local ? `Use local ${ui.name}` : `Connect ${ui.name}`}</h2>
            <p>{ui.blurb}</p>
          </div>
          <button type="button" className="icon-button sheet__close" onClick={onClose} aria-label="Close"><Icon name="close" /></button>
        </div>

        {demo && (
          <div className="sheet__body">
            <p className="sheet__note">This public demo is synthetic-only, so accounts can’t be connected here. Open the WindSwordAI app (hosted or local) to connect {ui.name}.</p>
            <div className="btn-row"><button type="button" className="btn btn--primary" onClick={onClose}>Got it</button></div>
          </div>
        )}

        {!demo && status.state === "needs_token" && (
          <div className="sheet__body">
            <p className="sheet__note">This gateway asks for an access token first. Add it under Advanced connection settings.</p>
            <div className="btn-row"><a className="btn btn--primary" href="/settings/#advanced" onClick={onClose}>Open Advanced settings</a></div>
          </div>
        )}

        {!demo && status.state !== "needs_token" && view && (
          <form className="sheet__body" onSubmit={submit}>
            {oauthReady && (
              <div className="sheet__primary">
                <button type="button" className="btn btn--primary btn--large" onClick={continueWithProvider} disabled={busy}>Continue to {ui.vendor}</button>
                <p className="sheet__hint">You’ll sign in on {ui.vendor}’s own page and come straight back here. WindSwordAI never sees your password.</p>
              </div>
            )}

            {oauthReady && !showKey && (
              <button type="button" className="link-button" onClick={() => setShowKey(true)}>Use a developer key instead</button>
            )}

            {!local && apiMethod && keyVisible && (
              <>
                {!oauthReady && <p className="sheet__note">{apiMethod.note}</p>}
                <div className="field">
                  <label htmlFor="connect-key">{apiMethod.label}</label>
                  <input id="connect-key" type="password" autoComplete="off" autoCapitalize="none" autoCorrect="off" spellCheck={false} value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder="Paste key" required />
                  <small>Checked once, then stored encrypted on the gateway. It never goes into this browser or any log.{d?.docsUrl ? <> <a href={d.docsUrl} target="_blank" rel="noreferrer noopener">Where do I find this?</a></> : null}</small>
                </div>
              </>
            )}

            {local && <p className="sheet__note">No account or key needed. WindSwordAI looks for Ollama running on this computer and lists the models you have installed.</p>}

            {(d?.requiresBaseUrl || (!local && keyVisible)) && (
              <details className="sheet__advanced" open={Boolean(d?.requiresBaseUrl)}>
                <summary>Custom endpoint{d?.requiresBaseUrl ? " (required)" : " (optional)"}</summary>
                <div className="field">
                  <label htmlFor="connect-base">Base URL</label>
                  <input id="connect-base" type="url" inputMode="url" autoCapitalize="none" autoCorrect="off" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder={d?.defaultBaseUrl ?? "https://…"} required={Boolean(d?.requiresBaseUrl)} />
                </div>
              </details>
            )}

            {error && <p className="form-error" role="alert">{error}</p>}

            {(local || (apiMethod && keyVisible)) && (
              <div className="btn-row">
                <button type="submit" className={oauthReady ? "btn" : "btn btn--primary btn--large"} disabled={busy || (!local && !apiKey)}>
                  {busy ? "Checking…" : local ? "Detect local models" : oauthReady ? "Connect with key" : `Connect ${ui.name}`}
                </button>
                <button type="button" className="btn" onClick={onClose}>Cancel</button>
              </div>
            )}
            {!local && !apiMethod && !oauthReady && (
              <p className="sheet__note">Connecting {ui.name} isn’t available yet. It’s on the roadmap.</p>
            )}
          </form>
        )}
      </div>
    </div>
  );
}
