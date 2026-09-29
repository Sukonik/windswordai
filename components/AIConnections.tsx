"use client";

import { useState, type FormEvent } from "react";
import { useGateway } from "@/components/GatewayProvider";
import { Icon } from "@/components/Icon";
import type { ConnectionType, ProviderView } from "@/gateway/src/types";

const usageLabel: Record<string, string> = {
  local: "Local inference (no account)",
  api_billing: "API billing on your provider account",
  subscription: "Subscription usage",
  enterprise: "Enterprise workspace",
};

function statusBadge(view: ProviderView, demo: boolean) {
  if (demo && view.descriptor.id !== "mock") return { text: "Needs gateway", cls: "badge" };
  if (view.status === "ready") return { text: view.descriptor.kind === "local" ? "Local · Ready" : "Connected", cls: "badge badge--ok" };
  if (view.status === "offline") return { text: "Offline", cls: "badge badge--warn" };
  if (view.status === "disabled") return { text: "Disabled", cls: "badge" };
  return { text: "Not connected", cls: "badge" };
}

function ProviderCard({ view, demo, onChanged }: { view: ProviderView; demo: boolean; onChanged: () => Promise<void> }) {
  const { transport, mode } = useGateway();
  const d = view.descriptor;
  const [apiKey, setApiKey] = useState("");
  const [baseUrl, setBaseUrl] = useState(view.connection?.baseUrl ?? "");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string }>();
  const [open, setOpen] = useState(false);

  const apiMethod = d.authMethods.find((m) => m.type === "api_key" && m.status === "available");
  const localMethod = d.authMethods.find((m) => m.type === "local" && m.status === "available");
  const badge = statusBadge(view, demo);
  const connected = view.status === "ready" && d.kind === "cloud";
  const activeType = view.connection?.type;
  const canConnect = !demo && (apiMethod || (localMethod && d.id !== "mock"));

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage(undefined);
    try {
      const type: ConnectionType = apiMethod ? "api_key" : "local";
      await transport.connect(d.id, { type, apiKey: apiMethod ? apiKey : undefined, baseUrl: baseUrl.trim() || undefined });
      setApiKey(""); // the key is never kept in UI state after submission
      setOpen(false);
      setMessage({ kind: "ok", text: apiMethod ? "Connected. The key is stored encrypted on the gateway, never in this browser." : "Local runtime detected." });
      await onChanged();
    } catch (err) {
      setMessage({ kind: "error", text: err instanceof Error ? err.message : "Could not connect." });
    } finally {
      setBusy(false);
    }
  }

  async function disconnect() {
    setBusy(true);
    setMessage(undefined);
    try {
      await transport.disconnect(d.id);
      setMessage({ kind: "ok", text: "Disconnected. Stored credentials were deleted." });
      await onChanged();
    } catch (err) {
      setMessage({ kind: "error", text: err instanceof Error ? err.message : "Could not disconnect." });
    } finally {
      setBusy(false);
    }
  }

  const eligibility = view.eligibility;
  const modelNames = view.models.slice(0, 4).map((m) => m.label);

  return (
    <article className="provider-card" aria-label={d.displayName}>
      <div className="provider-card__head">
        <h3>{d.displayName}</h3>
        <span className={badge.cls}><i aria-hidden="true" />{badge.text}</span>
        <span className="badge">{d.kind === "local" ? "Local" : "Cloud"}</span>
      </div>
      <dl>
        <div>
          <dt>Connection</dt>
          <dd>{activeType ? `${activeType === "api_key" ? "Developer / API key" : activeType}${view.connection?.baseUrl ? ` · ${view.connection.baseUrl}` : ""}` : d.kind === "local" ? "Local runtime" : "None yet"}</dd>
        </div>
        <div>
          <dt>Usage source</dt>
          <dd>{usageLabel[(activeType ? d.authMethods.find((m) => m.type === activeType) : d.authMethods.find((m) => m.status === "available"))?.usageSource ?? "api_billing"]}</dd>
        </div>
        <div>
          <dt>Privacy / egress</dt>
          <dd>{d.egress.classification === "none" ? "No egress. " : "Leaves this device. "}{d.egress.retention}</dd>
        </div>
        <div>
          <dt>Models</dt>
          <dd>{view.models.length ? `${modelNames.join(", ")}${view.models.length > 4 ? ` +${view.models.length - 4} more` : ""}` : d.kind === "cloud" ? "Discovered when you connect" : "None detected"}</dd>
        </div>
        <div>
          <dt>Policy ({mode === "secure_local" ? "Secure Local" : "Standard"})</dt>
          <dd>{eligibility.allow ? "Allowed for general prompts." : eligibility.reason}</dd>
        </div>
      </dl>
      <ul className="method-list" aria-label={`${d.displayName} connection methods`}>
        {d.authMethods.map((m) => (
          <li key={m.type}><strong>{m.label}</strong> — {m.status === "available" ? "available" : m.status === "planned" ? "planned" : "not offered by vendor"}. {m.note}</li>
        ))}
      </ul>

      {message && <p className={message.kind === "ok" ? "form-ok" : "form-error"} role={message.kind === "ok" ? "status" : "alert"}>{message.text}</p>}

      {demo && d.id !== "mock" && <p>Connecting accounts needs a running WindSwordAI gateway. See “Gateway” above.</p>}

      {canConnect && (
        <div className="btn-row">
          {!connected && !open && <button type="button" className="btn btn--primary" onClick={() => setOpen(true)}>{apiMethod ? "Connect" : "Detect local models"}</button>}
          {connected && !open && <button type="button" className="btn" onClick={() => setOpen(true)}>Reconnect</button>}
          {(connected || (activeType && d.kind === "local")) && <button type="button" className="btn btn--danger" onClick={disconnect} disabled={busy}>Disconnect</button>}
        </div>
      )}

      {canConnect && open && (
        <form className="connect-form" onSubmit={submit}>
          {apiMethod && (
            <div className="field">
              <label htmlFor={`key-${d.id}`}>{apiMethod.label}</label>
              <input id={`key-${d.id}`} type="password" autoComplete="off" autoCapitalize="none" autoCorrect="off" spellCheck={false} value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder="Paste key" required />
              <small>Sent once over your gateway connection, verified by listing models, then stored encrypted on the gateway. Never stored in the browser or logs.</small>
            </div>
          )}
          {(d.requiresBaseUrl || d.defaultBaseUrl) && (
            <div className="field">
              <label htmlFor={`base-${d.id}`}>Base URL{d.requiresBaseUrl ? "" : " (optional)"}</label>
              <input id={`base-${d.id}`} type="url" inputMode="url" autoCapitalize="none" autoCorrect="off" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder={d.defaultBaseUrl ?? "https://…"} required={d.requiresBaseUrl} />
            </div>
          )}
          <div className="btn-row">
            <button type="submit" className="btn btn--primary" disabled={busy || (Boolean(apiMethod) && !apiKey)}>{busy ? "Checking…" : apiMethod ? "Verify and connect" : "Detect"}</button>
            <button type="button" className="btn" onClick={() => { setOpen(false); setApiKey(""); }}>Cancel</button>
          </div>
        </form>
      )}
    </article>
  );
}

export function AIConnections() {
  const { status, mode, setMode, providers, loading, error, refresh, settings, saveSettings } = useGateway();
  const demo = status.state === "demo" || status.state === "checking";
  const [url, setUrl] = useState(settings.url ?? "");
  const [token, setToken] = useState(settings.token ?? "");
  const [checking, setChecking] = useState(false);

  async function check(event: FormEvent) {
    event.preventDefault();
    setChecking(true);
    await saveSettings({ url, token });
    setChecking(false);
  }

  return (
    <section className="settings-page">
      <header>
        <p className="eyebrow">Configuration</p>
        <h1>AI Connections</h1>
        <p className="settings-lede">
          WindSwordAI is provider-neutral. Connect the AI accounts you already use, or run fully local. Every request passes one policy gate before it can leave this device.
        </p>
      </header>

      <div className={demo ? "panel panel--notice" : "panel"}>
        <h2>Gateway</h2>
        {status.state === "connected" && <p role="status"><span className="badge badge--ok"><i aria-hidden="true" />Connected</span> {status.url}</p>}
        {status.state === "needs_token" && <p role="status"><span className="badge badge--warn"><i aria-hidden="true" />Token required</span> A gateway was found at {status.url}. Enter its token below.</p>}
        {status.state === "demo" && <p role="status"><span className="badge">Demo</span> No gateway found. This public build uses a synthetic in-browser provider; nothing leaves your device.</p>}
        {status.state === "checking" && <p role="status">Looking for a gateway…</p>}
        <form className="connect-form" onSubmit={check}>
          <div className="field">
            <label htmlFor="gw-url">Gateway URL (optional)</label>
            <input id="gw-url" type="url" inputMode="url" autoCapitalize="none" autoCorrect="off" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="http://127.0.0.1:8787" />
            <small>Leave blank to use the site you are on. Run <code>npm run start:local</code> to start the gateway and serve this UI from it.</small>
          </div>
          <div className="field">
            <label htmlFor="gw-token">Gateway token (only if the gateway prints one)</label>
            <input id="gw-token" type="password" autoComplete="off" autoCapitalize="none" value={token} onChange={(e) => setToken(e.target.value)} />
          </div>
          <div className="btn-row"><button type="submit" className="btn" disabled={checking}>{checking ? "Checking…" : "Check connection"}</button></div>
        </form>
      </div>

      <div className="panel">
        <h2>Execution mode</h2>
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

      {error && <p className="form-error" role="alert">{error}</p>}
      {loading && <p role="status">Loading providers…</p>}
      <div className="provider-grid">
        {providers.map((view) => <ProviderCard key={view.descriptor.id} view={view} demo={demo} onChanged={refresh} />)}
      </div>
    </section>
  );
}
