"use client";

import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { useGateway } from "@/components/GatewayProvider";
import { ProviderMark } from "@/components/ProviderMark";
import { Icon } from "@/components/Icon";
import { useSheetBehavior } from "@/components/useSheetBehavior";
import { AdminError, createAdminClient, type AdminConnection, type AdminField, type AdminList, type ConnectionStatusLabel } from "@/lib/gateway/admin";

const GROUPS: AdminConnection["group"][] = ["Identity", "AI Providers", "Storage", "Local Services"];

const STATUS: Record<ConnectionStatusLabel, { text: string; tone: "ok" | "warn" | "" }> = {
  connected: { text: "Connected ✓", tone: "ok" },
  ready: { text: "Ready", tone: "ok" },
  needs_setup: { text: "Needs setup", tone: "" },
  error: { text: "Connection error", tone: "warn" },
  coming_soon: { text: "Coming soon", tone: "" },
};

function StatusBadge({ status }: { status: ConnectionStatusLabel }) {
  const s = STATUS[status];
  return <span className={s.tone ? `badge badge--${s.tone}` : "badge"}><i aria-hidden="true" />{s.text}</span>;
}

/** Settings → Connections (WindSword Connect). Built from the gateway's connection definitions; one renderer serves every provider. */
export function ConnectionsPanel() {
  const { status } = useGateway();
  const url = status.state === "connected" || status.state === "login_required" ? status.url : undefined;
  const client = useMemo(() => (url ? createAdminClient(url) : undefined), [url]);
  const [list, setList] = useState<AdminList>();
  const [loadError, setLoadError] = useState<string>();
  const [openId, setOpenId] = useState<string>();
  const [unlocking, setUnlocking] = useState(false);

  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    if (!client) return;
    let live = true;
    client.list().then(
      (result) => { if (live) { setList(result); setLoadError(undefined); } },
      () => { if (live) setLoadError("Couldn’t reach the gateway."); },
    );
    return () => { live = false; };
  }, [client, reloadKey]);

  const patch = (c: AdminConnection) => setList((cur) => (cur && cur.access === "ok" ? { ...cur, connections: cur.connections.map((x) => (x.id === c.id ? c : x)) } : cur));
  const open = list?.access === "ok" ? list.connections.find((c) => c.id === openId) : undefined;

  return (
    <section className="settings-page connections" id="connections" aria-labelledby="connections-title">
      <header>
        <p className="eyebrow">Configuration</p>
        <h2 id="connections-title" className="settings-title">Connections</h2>
        <p className="settings-lede">Securely connect identity, AI providers, and storage services.</p>
      </header>

      {!client && (
        <p className="panel panel--notice" role="status">Connections are managed in the WindSwordAI app. This public demo has no gateway, so there is nothing to set up here.</p>
      )}
      {loadError && <p className="form-error" role="alert">{loadError}</p>}

      {list?.access === "disabled" && (
        <div className="panel" role="status">
          <span className="badge"><i aria-hidden="true" />Admin disabled</span>
          <p className="sheet__note">{list.message}</p>
        </div>
      )}

      {list?.access === "locked" && (
        <div className="panel" role="status">
          <span className="badge"><i aria-hidden="true" />Administrator only</span>
          <p className="sheet__note">Managing connections needs the administrator’s access code.</p>
          <div className="btn-row"><button type="button" className="btn btn--primary" onClick={() => setUnlocking(true)}>Enter access code</button></div>
        </div>
      )}

      {list?.access === "ok" && GROUPS.map((group) => {
        const items = list.connections.filter((c) => c.group === group);
        if (!items.length) return null;
        return (
          <div key={group} className="connections__group">
            <h3 className="connections__label">{group}</h3>
            <div className="provider-grid">
              {items.map((c) => (
                <article key={c.id} className="provider-card" aria-label={c.name}>
                  <div className="provider-card__head">
                    <ProviderMark id={c.id} displayName={c.name} size={40} />
                    <div className="provider-card__title">
                      <h4>{c.name}</h4>
                      <p>{c.description}</p>
                    </div>
                  </div>
                  <div className="provider-card__action">
                    <StatusBadge status={c.status} />
                    {c.comingSoon
                      ? null
                      : <button type="button" className={c.status === "needs_setup" ? "btn btn--primary" : "btn"} onClick={() => setOpenId(c.id)}>{c.status === "needs_setup" ? "Connect" : "Manage"}</button>}
                  </div>
                </article>
              ))}
            </div>
          </div>
        );
      })}

      {unlocking && client && <UnlockSheet client={client} onClose={() => setUnlocking(false)} onUnlocked={() => { setUnlocking(false); setReloadKey((k) => k + 1); }} />}
      {open && client && list?.access === "ok" && (
        <ConnectionSheet key={open.id} connection={open} client={client} csrf={list.csrfToken} onChange={patch} onClose={() => setOpenId(undefined)} />
      )}
    </section>
  );
}

function UnlockSheet({ client, onClose, onUnlocked }: { client: ReturnType<typeof createAdminClient>; onClose: () => void; onUnlocked: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  useSheetBehavior(ref, onClose);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(undefined);
    try {
      await client.unlock(code);
      setCode("");
      onUnlocked();
    } catch (err) {
      setError(err instanceof AdminError ? err.message : "Couldn’t unlock.");
      setBusy(false);
    }
  }

  return (
    <div className="sheet-scrim" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="sheet" role="dialog" aria-modal="true" aria-labelledby="unlock-title" ref={ref} tabIndex={-1}>
        <div className="sheet__head">
          <span className="provider-mark" style={{ width: 44, height: 44 }} aria-hidden="true"><Icon name="lock" size={20} /></span>
          <div><h2 id="unlock-title">Administrator access</h2><p>Enter the access code from your hosting settings.</p></div>
          <button type="button" className="icon-button sheet__close" onClick={onClose} aria-label="Close"><Icon name="close" /></button>
        </div>
        <form className="sheet__body" onSubmit={submit}>
          <div className="field">
            <label htmlFor="admin-code">Access code</label>
            <input id="admin-code" type="password" autoComplete="off" autoCapitalize="none" autoCorrect="off" spellCheck={false} value={code} onChange={(e) => setCode(e.target.value)} required />
          </div>
          {error && <p className="form-error" role="alert">{error}</p>}
          <div className="btn-row">
            <button type="submit" className="btn btn--primary btn--large" disabled={busy || !code}>{busy ? "Checking…" : "Unlock"}</button>
            <button type="button" className="btn" onClick={onClose}>Cancel</button>
          </div>
        </form>
      </div>
    </div>
  );
}

function ConnectionSheet({ connection, client, csrf, onChange, onClose }: { connection: AdminConnection; client: ReturnType<typeof createAdminClient>; csrf: string; onChange: (c: AdminConnection) => void; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useSheetBehavior(ref, onClose);
  const initial = useMemo(() => {
    const v: Record<string, string | boolean> = {};
    for (const f of connection.fields) v[f.name] = f.secret ? "" : f.type === "checkbox" ? (connection.status === "needs_setup" ? true : connection.values[f.name] === true) : String(connection.values[f.name] ?? "");
    return v;
  }, [connection]);
  const [values, setValues] = useState(initial);
  const [replacing, setReplacing] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState<"save" | "test" | "remove" | undefined>();
  const [message, setMessage] = useState<{ ok: boolean; text: string }>();
  const [confirmRemove, setConfirmRemove] = useState(false);
  const readOnly = connection.managedByServer;
  const configured = connection.status !== "needs_setup";

  const set = (name: string, v: string | boolean) => setValues((cur) => ({ ...cur, [name]: v }));
  const fail = (err: unknown) => setMessage({ ok: false, text: err instanceof AdminError ? err.message : "That didn’t work. Please try again." });

  async function save(event: FormEvent) {
    event.preventDefault();
    setBusy("save");
    setMessage(undefined);
    try {
      const { connection: next } = await client.save(connection.id, values, csrf);
      // Secrets never stay in browser state after they are sent.
      setValues((cur) => Object.fromEntries(Object.entries(cur).map(([k, v]) => [k, connection.fields.find((f) => f.name === k)?.secret ? "" : v])));
      setReplacing({});
      onChange(next);
      setMessage({ ok: true, text: "Saved ✓" });
    } catch (err) { fail(err); }
    setBusy(undefined);
  }

  async function test() {
    setBusy("test");
    setMessage(undefined);
    try {
      const { connection: next, result } = await client.test(connection.id, csrf);
      onChange(next);
      setMessage({ ok: result.ok, text: result.message });
    } catch (err) { fail(err); }
    setBusy(undefined);
  }

  async function remove() {
    setBusy("remove");
    try {
      const { connection: next } = await client.remove(connection.id, csrf);
      onChange(next);
      onClose();
    } catch (err) { fail(err); setBusy(undefined); }
  }

  const advanced = connection.advanced;

  return (
    <div className="sheet-scrim" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="sheet" role="dialog" aria-modal="true" aria-labelledby="conn-title" ref={ref} tabIndex={-1}>
        <div className="sheet__head">
          <ProviderMark id={connection.id} displayName={connection.name} size={44} />
          <div>
            <h2 id="conn-title">{connection.name}</h2>
            <p>{connection.description}</p>
          </div>
          <button type="button" className="icon-button sheet__close" onClick={onClose} aria-label="Close"><Icon name="close" /></button>
        </div>

        <form className="sheet__body" onSubmit={save}>
          <p className="connections__status" role="status"><StatusBadge status={connection.status} /></p>
          {readOnly && <p className="sheet__note">This connection is already set up by the server, so there is nothing to enter.</p>}

          {connection.fields.map((f) => (
            <FieldInput key={f.name} field={f} value={values[f.name]} secretSet={Boolean(connection.secretsSet[f.name])} replacing={Boolean(replacing[f.name])} disabled={readOnly}
              onChange={(v) => set(f.name, v)} onReplace={() => setReplacing((r) => ({ ...r, [f.name]: true }))} />
          ))}

          {message && <p className={message.ok ? "connections__result" : "form-error"} role="status">{message.text}</p>}

          {!readOnly && (
            <div className="btn-row">
              <button type="submit" className="btn btn--primary btn--large" disabled={busy !== undefined}>{busy === "save" ? "Saving…" : "Save"}</button>
              {configured && connection.canTest && <button type="button" className="btn" onClick={test} disabled={busy !== undefined}>{busy === "test" ? "Testing…" : "Test Connection"}</button>}
              {configured && connection.tryLink && <a className="btn" href={`${client.base}${connection.tryLink.href}`}>{connection.tryLink.label}</a>}
            </div>
          )}

          {(advanced.items.length > 0 || advanced.note) && (
            <details className="sheet__advanced">
              <summary>Advanced</summary>
              {advanced.note && <p className="sheet__note">{advanced.note}</p>}
              <dl className="connections__advanced">
                {advanced.items.map((i) => (<div key={i.label}><dt>{i.label}</dt><dd><code>{i.value}</code></dd></div>))}
              </dl>
            </details>
          )}

          {configured && !readOnly && (
            <div className="connections__danger">
              {!confirmRemove ? (
                <button type="button" className="btn btn--danger" onClick={() => setConfirmRemove(true)} disabled={busy !== undefined}>Remove connection</button>
              ) : (
                <>
                  <p className="sheet__note">Remove {connection.name}? Its saved details are deleted from the server.</p>
                  <div className="btn-row">
                    <button type="button" className="btn btn--danger" onClick={remove} disabled={busy !== undefined}>{busy === "remove" ? "Removing…" : "Yes, remove"}</button>
                    <button type="button" className="btn" onClick={() => setConfirmRemove(false)}>Keep it</button>
                  </div>
                </>
              )}
            </div>
          )}
        </form>
      </div>
    </div>
  );
}

function FieldInput({ field, value, secretSet, replacing, disabled, onChange, onReplace }: { field: AdminField; value: string | boolean; secretSet: boolean; replacing: boolean; disabled: boolean; onChange: (v: string | boolean) => void; onReplace: () => void }) {
  const id = `conn-${field.name}`;
  if (field.type === "checkbox") {
    return (
      <label className="connections__check" htmlFor={id}>
        <input id={id} type="checkbox" checked={value === true} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
        <span>{field.label}</span>
      </label>
    );
  }
  if (field.secret) {
    // The saved secret is never sent to the browser: only "saved" is known. Replacing is an explicit action.
    if (secretSet && !replacing) {
      return (
        <div className="field">
          <span className="field__label">{field.label}</span>
          <div className="connections__saved"><span className="connections__saved-text"><Icon name="lock" size={14} /> Secret saved ✓</span>
            {!disabled && <button type="button" className="link-button" onClick={onReplace}>Replace secret</button>}
          </div>
        </div>
      );
    }
    return (
      <div className="field">
        <label htmlFor={id}>{field.label}</label>
        <input id={id} type="password" name={`ws-${field.name}`} autoComplete="new-password" autoCapitalize="none" autoCorrect="off" spellCheck={false} data-lpignore="true"
          value={String(value)} onChange={(e) => onChange(e.target.value)} placeholder="Paste it here" required={field.required && !secretSet} disabled={disabled} />
        {field.help && <small>{field.help}</small>}
      </div>
    );
  }
  if (field.type === "select") {
    return (
      <div className="field">
        <label htmlFor={id}>{field.label}</label>
        <select id={id} value={String(value)} onChange={(e) => onChange(e.target.value)} disabled={disabled}>
          {(field.options ?? []).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        {field.help && <small>{field.help}</small>}
      </div>
    );
  }
  return (
    <div className="field">
      <label htmlFor={id}>{field.label}</label>
      <input id={id} type={field.type === "url" ? "url" : "text"} inputMode={field.type === "url" ? "url" : undefined} autoComplete="off" autoCapitalize="none" autoCorrect="off" spellCheck={false}
        value={String(value)} onChange={(e) => onChange(e.target.value)} placeholder={field.placeholder} required={field.required} disabled={disabled} />
      {field.help && <small>{field.help}</small>}
    </div>
  );
}
