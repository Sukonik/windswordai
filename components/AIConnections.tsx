"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { useConnect } from "@/components/ConnectProvider";
import { useGateway } from "@/components/GatewayProvider";
import { Icon } from "@/components/Icon";
import { ProviderMark } from "@/components/ProviderMark";
import { providerUi } from "@/lib/gateway/provider-ui";
import type { ProviderView } from "@/gateway/src/types";

const usageLabel: Record<string, string> = {
  local: "Local inference (no account)",
  api_billing: "Developer account billing",
  subscription: "Subscription usage",
  enterprise: "Enterprise workspace",
};

function ProviderCard({ view, demo }: { view: ProviderView; demo: boolean }) {
  const { transport, mode, refresh } = useGateway();
  const { open, notify } = useConnect();
  const d = view.descriptor;
  const ui = providerUi(d.id, d.displayName);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string }>();

  const isLocal = d.kind === "local";
  const isMock = d.id === "mock";
  const connected = !isLocal && view.status === "ready";
  const activeType = view.connection?.type;
  const method = activeType ? d.authMethods.find((m) => m.type === activeType) : d.authMethods.find((m) => m.status === "available");

  let badge = { text: "Not connected", cls: "badge" };
  if (isMock) badge = { text: "Built in", cls: "badge badge--ok" };
  else if (demo && !isMock) badge = { text: "Available in the app", cls: "badge" };
  else if (isLocal && view.status === "ready") badge = { text: "Ready", cls: "badge badge--ok" };
  else if (view.status === "offline") badge = { text: "Not running", cls: "badge badge--warn" };
  else if (connected) badge = { text: activeType === "oauth" ? "Connected · account" : "Connected", cls: "badge badge--ok" };

  async function disconnect() {
    setBusy(true);
    setMessage(undefined);
    try {
      await transport.disconnect(d.id);
      notify(`${ui.name} disconnected. Stored credentials were deleted.`);
      await refresh();
    } catch (err) {
      setMessage({ kind: "error", text: err instanceof Error ? err.message : "Could not disconnect." });
    } finally {
      setBusy(false);
    }
  }

  async function checkLocal() {
    setBusy(true);
    setMessage(undefined);
    try {
      await refresh();
      setMessage({ kind: "ok", text: "Checked." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <article className="provider-card" aria-label={ui.name} data-provider={d.id}>
      <div className="provider-card__head">
        <ProviderMark id={d.id} displayName={d.displayName} size={44} />
        <div className="provider-card__title">
          <h3>{ui.name}</h3>
          <p>{ui.blurb}</p>
        </div>
      </div>

      <div className="provider-card__action">
        <span className={badge.cls}><i aria-hidden="true" />{badge.text}</span>
        {isMock && null}
        {!isMock && !isLocal && !connected && (
          <button type="button" className="btn btn--primary" onClick={() => open({ providerId: d.id })}>Connect {ui.name}</button>
        )}
        {connected && (
          <>
            <button type="button" className="btn" onClick={() => open({ providerId: d.id })}>Reconnect</button>
            <button type="button" className="btn btn--danger" onClick={disconnect} disabled={busy}>Disconnect</button>
          </>
        )}
        {isLocal && !isMock && view.status === "ready" && <button type="button" className="btn" onClick={checkLocal} disabled={busy}>Refresh models</button>}
        {isLocal && !isMock && view.status !== "ready" && !demo && (
          <>
            <button type="button" className="btn btn--primary" onClick={checkLocal} disabled={busy}>Use local {ui.name}</button>
          </>
        )}
        {isLocal && !isMock && demo && <button type="button" className="btn" onClick={() => open({ providerId: d.id })}>Use local {ui.name}</button>}
      </div>

      {message && <p className={message.kind === "ok" ? "form-ok" : "form-error"} role={message.kind === "ok" ? "status" : "alert"}>{message.text}</p>}
      {isLocal && !isMock && view.status === "offline" && <p className="provider-card__hint">Start Ollama on this computer, then choose “Use local {ui.name}”.</p>}

      <details className="provider-card__details">
        <summary>Details</summary>
        <dl>
          <div><dt>Connection</dt><dd>{activeType ? `${activeType === "api_key" ? "Developer account (API key)" : activeType === "oauth" ? "Linked account" : activeType}${view.connection?.baseUrl ? ` · ${view.connection.baseUrl}` : ""}` : isLocal ? "Local runtime" : "None yet"}</dd></div>
          <div><dt>Usage source</dt><dd>{usageLabel[method?.usageSource ?? "api_billing"]}</dd></div>
          <div><dt>Privacy</dt><dd>{d.egress.classification === "none" ? "Nothing leaves this device. " : "Leaves this device. "}{d.egress.retention}</dd></div>
          <div><dt>Models</dt><dd>{view.models.length ? view.models.slice(0, 6).map((m) => m.label).join(", ") + (view.models.length > 6 ? ` +${view.models.length - 6} more` : "") : isLocal ? "None detected" : "Found when you connect"}</dd></div>
          <div><dt>Policy · {mode === "secure_local" ? "Secure Local" : "Standard"}</dt><dd>{view.eligibility.allow ? "Allowed for general prompts." : view.eligibility.reason}</dd></div>
        </dl>
        <ul className="method-list" aria-label={`${ui.name} connection methods`}>
          {d.authMethods.map((m) => (
            <li key={m.type}><strong>{m.label}</strong> — {m.status === "available" ? "available" : m.status === "planned" ? "planned" : "not offered by the vendor"}. {m.note}</li>
          ))}
        </ul>
      </details>
    </article>
  );
}

export function AIConnections() {
  const { status, mode, setMode, providers, loading, error, settings, saveSettings, linked, clearLinked } = useGateway();
  const { notify } = useConnect();
  const demo = status.state === "demo" || status.state === "checking";
  const [url, setUrl] = useState(settings.url ?? "");
  const [token, setToken] = useState(settings.token ?? "");
  const [checking, setChecking] = useState(false);
  const advancedRef = useRef<HTMLDetailsElement>(null);

  // Returning from an account-linking redirect: say what happened once.
  useEffect(() => {
    if (!linked) return;
    const name = providerUi(linked.providerId).name;
    notify(linked.ok ? `${name} connected.` : `${name} wasn’t connected. Authorization was cancelled or expired.`);
    clearLinked();
  }, [linked, notify, clearLinked]);

  // /settings/#advanced opens the technical section.
  useEffect(() => {
    if (window.location.hash === "#advanced" && advancedRef.current) advancedRef.current.open = true;
  }, []);

  async function check(event: FormEvent) {
    event.preventDefault();
    setChecking(true);
    await saveSettings({ url, token });
    setChecking(false);
  }

  const visible = providers.filter((p) => p.descriptor.id !== "mock");
  const mock = providers.find((p) => p.descriptor.id === "mock");

  return (
    <section className="settings-page">
      <header>
        <p className="eyebrow">Configuration</p>
        <h1>AI Connections</h1>
        <p className="settings-lede">
          Connect the AI services you already use. WindSwordAI handles each connection securely and applies your privacy policy before sending anything outside the app.
        </p>
      </header>

      {demo && (
        <p className="panel panel--notice" role="status">
          This public build is a synthetic demo, so accounts can’t be connected here. Nothing leaves your device.
        </p>
      )}

      {error && <p className="form-error" role="alert">{error}</p>}
      {loading && <p role="status">Loading…</p>}

      <div className="provider-grid">
        {visible.map((view) => <ProviderCard key={view.descriptor.id} view={view} demo={demo} />)}
        {mock && demo && <ProviderCard view={mock} demo={demo} />}
      </div>

      <div className="panel">
        <h2>Privacy mode</h2>
        <div className="mode-choice" role="group" aria-label="Execution mode">
          <button type="button" aria-pressed={mode === "secure_local"} onClick={() => setMode("secure_local")}>
            <strong><Icon name="lock" size={14} /> Secure Local</strong>
            <small>Default. Only local providers run. Cloud providers are visibly disabled.</small>
          </button>
          <button type="button" aria-pressed={mode === "standard"} onClick={() => setMode("standard")}>
            <strong><Icon name="globe" size={14} /> Standard</strong>
            <small>Connected cloud providers allowed for general prompts. Protected or document-bearing material still never goes to the cloud.</small>
          </button>
        </div>
      </div>

      <details className="panel panel--advanced" id="advanced" ref={advancedRef}>
        <summary><h2>Advanced connection settings</h2><span>Gateway, token and diagnostics</span></summary>
        <p role="status">
          {status.state === "connected" && <><span className="badge badge--ok"><i aria-hidden="true" />Gateway connected</span> {status.url}</>}
          {status.state === "needs_token" && <><span className="badge badge--warn"><i aria-hidden="true" />Token required</span> A gateway was found at {status.url}. Enter its token below.</>}
          {status.state === "demo" && <><span className="badge">Demo</span> No gateway found.</>}
          {status.state === "checking" && "Looking for a gateway…"}
        </p>
        <form className="connect-form" onSubmit={check}>
          <div className="field">
            <label htmlFor="gw-url">Gateway URL (optional)</label>
            <input id="gw-url" type="url" inputMode="url" autoCapitalize="none" autoCorrect="off" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="http://127.0.0.1:8787" />
            <small>Hosted WindSwordAI configures this automatically. For a local install run <code>npm run start:local</code>.</small>
          </div>
          <div className="field">
            <label htmlFor="gw-token">Gateway token (only if the gateway prints one)</label>
            <input id="gw-token" type="password" autoComplete="off" autoCapitalize="none" value={token} onChange={(e) => setToken(e.target.value)} />
          </div>
          <div className="btn-row"><button type="submit" className="btn" disabled={checking}>{checking ? "Checking…" : "Check connection"}</button></div>
        </form>
        <dl className="diagnostics">
          <div><dt>Providers loaded</dt><dd>{providers.length}</dd></div>
          <div><dt>Mode</dt><dd>{mode === "secure_local" ? "Secure Local" : "Standard"}</dd></div>
          <div><dt>Transport</dt><dd>{status.state === "connected" ? "WindSwordAI gateway" : "In-browser demo"}</dd></div>
        </dl>
      </details>
    </section>
  );
}
