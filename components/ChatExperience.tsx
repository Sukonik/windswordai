"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { useConnect } from "@/components/ConnectProvider";
import { Icon } from "@/components/Icon";
import { useGateway } from "@/components/GatewayProvider";
import { ProviderMark } from "@/components/ProviderMark";
import { WakeMark } from "@/components/WakeMark";
import { loadChoice, saveChoice } from "@/lib/gateway/settings";
import { providerUi } from "@/lib/gateway/provider-ui";
import type { ChatMessage, ProviderView, StreamEvent } from "@/gateway/src/types";

type ReplyStatus = "streaming" | "done" | "error" | "blocked" | "cancelled";

interface Reply {
  id: number;
  providerId: string;
  model: string;
  providerName: string;
  modelLabel: string;
  text: string;
  status: ReplyStatus;
  message?: string;
  retryable?: boolean;
  usage?: { inputTokens?: number; outputTokens?: number };
}

interface Turn {
  id: number;
  prompt: string;
  attachments: string[];
  protectedMaterial: boolean;
  /** Exact messages sent, so Retry re-sends the identical request. */
  messages: ChatMessage[];
  compareGroupId?: string;
  replies: Reply[];
}

const actions = [
  { label: "Add photos", detail: "PNG, JPG, TIFF", symbol: "▧", attachment: "Site-photo.jpg" },
  { label: "Add files", detail: "PDF, DOCX, XLSX + more", symbol: "⌑", attachment: "Sample-License-Agreement.pdf" },
  { label: "Add from matter", detail: "Choose a secure workspace", symbol: "◇", attachment: "Matter: Boardwalk License Review" },
  { label: "Recent documents", detail: "Your latest local files", symbol: "↺", attachment: "Sample-Council-Memo.docx" },
];

const RESUME_KEY = "windsword-chat-resume";

const suggestions = ["Review a contract", "Compare documents", "Case timeline", "Summarize matter"];

interface Choice { providerId: string; model: string }

function usable(view: ProviderView, protectedMaterial: boolean) {
  const decision = protectedMaterial ? view.protectedEligibility : view.eligibility;
  return view.status === "ready" && decision.allow && view.models.length > 0;
}

/** Pick the saved choice if it is still usable, otherwise the first usable provider (local first in secure mode). */
function resolveChoice(providers: ProviderView[], wanted: Choice | undefined, protectedMaterial: boolean): Choice | undefined {
  const hit = wanted && providers.find((p) => p.descriptor.id === wanted.providerId);
  if (hit && usable(hit, protectedMaterial) && hit.models.some((m) => m.id === wanted.model)) return wanted;
  if (hit && usable(hit, protectedMaterial)) return { providerId: hit.descriptor.id, model: hit.models[0].id };
  const first = providers.find((p) => usable(p, protectedMaterial));
  return first ? { providerId: first.descriptor.id, model: first.models[0].id } : undefined;
}

function providerNote(p: ProviderView, protectedMaterial: boolean, demo: boolean) {
  const decision = protectedMaterial ? p.protectedEligibility : p.eligibility;
  if (p.status === "disabled") return { note: " — disabled", disabled: true };
  if (!decision.allow && decision.code === "secure_local_blocks_cloud") return { note: " — blocked in Secure Local", disabled: true };
  if (!decision.allow && decision.code === "protected_content_blocks_cloud") return { note: " — blocked for protected material", disabled: true };
  if (demo && p.descriptor.id !== "mock") return { note: " — connect in the app", disabled: false };
  if (p.status === "offline") return { note: " — not running", disabled: false };
  if (p.status === "not_connected" || (p.status === "ready" && p.models.length === 0)) return { note: p.descriptor.kind === "local" ? " — detect" : " — connect", disabled: false };
  return { note: "", disabled: false };
}

/** Provider chip: shows identity; picking a provider that is not connected opens the connect sheet. */
function ProviderPicker({
  label, value, providers, protectedMaterial, demo, onPick,
}: {
  label: string;
  value?: string;
  providers: ProviderView[];
  protectedMaterial: boolean;
  demo: boolean;
  onPick: (providerId: string) => void;
}) {
  const current = providers.find((p) => p.descriptor.id === value);
  const ui = providerUi(value ?? "", current?.descriptor.displayName);
  return (
    <label className="pill-select pill-select--provider">
      {value ? <ProviderMark id={value} displayName={current?.descriptor.displayName} size={22} /> : <span className="model-select__orb" aria-hidden="true" />}
      <span className="pill-select__text">{value ? ui.name : "No provider"}</span>
      <Icon name="chevron" size={14} />
      <select aria-label={label} value={value ?? ""} onChange={(event) => onPick(event.target.value)}>
        {!value && <option value="">No provider available</option>}
        {providers.map((p) => {
          const { note, disabled } = providerNote(p, protectedMaterial, demo);
          return <option key={p.descriptor.id} value={p.descriptor.id} disabled={disabled}>{providerUi(p.descriptor.id, p.descriptor.displayName).name}{note}</option>;
        })}
      </select>
    </label>
  );
}

function ModelPicker({ label, choice, providers, onChange }: { label: string; choice?: Choice; providers: ProviderView[]; onChange: (choice: Choice) => void }) {
  const view = choice && providers.find((p) => p.descriptor.id === choice.providerId);
  const models = view?.models.slice(0, 60) ?? [];
  const current = models.find((m) => m.id === choice?.model);
  return (
    <label className="pill-select pill-select--model">
      <span className="pill-select__text">{current?.label ?? (models.length ? "Model" : "No models")}</span>
      <Icon name="chevron" size={14} />
      <select aria-label={label} value={choice?.model ?? ""} disabled={!models.length} onChange={(event) => choice && onChange({ providerId: choice.providerId, model: event.target.value })}>
        {!models.length && <option value="">No models</option>}
        {models.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
      </select>
    </label>
  );
}

function ReplyBody({ reply, onStop, onRetry }: { reply: Reply; onStop: () => void; onRetry: () => void }) {
  return (
    <div className="reply__body" data-status={reply.status}>
      <div className="reply__head">
        <ProviderMark id={reply.providerId} displayName={reply.providerName} size={20} />
        <span className="message-role">{reply.providerName}</span>
        <span className="reply__model">{reply.modelLabel}</span>
        <span className="reply__status" aria-live="polite">
          {reply.status === "streaming" && "Streaming…"}
          {reply.status === "cancelled" && "Stopped"}
          {reply.status === "blocked" && "Blocked by policy"}
          {reply.status === "error" && "Failed"}
        </span>
        {reply.status === "streaming" && (
          <button type="button" className="reply__action" onClick={onStop} aria-label={`Stop ${reply.providerName}`}>
            <Icon name="stop" size={14} /><span>Stop</span>
          </button>
        )}
        {(reply.status === "error" || reply.status === "cancelled" || reply.status === "blocked") && reply.retryable !== false && (
          <button type="button" className="reply__action" onClick={onRetry} aria-label={`Retry ${reply.providerName}`}>
            <Icon name="retry" size={14} /><span>Retry</span>
          </button>
        )}
      </div>
      {reply.status === "streaming" && !reply.text && <div className="thinking-line" aria-label="Waiting for the first tokens"><i /><i /><i /></div>}
      {reply.text && <p className="reply__text">{reply.text}</p>}
      {reply.status === "blocked" && (
        <p className="reply__notice reply__notice--blocked" role="status"><Icon name="lock" size={16} /><span>{reply.message}</span></p>
      )}
      {reply.status === "error" && (
        <p className="reply__notice reply__notice--error" role="alert"><span>{reply.message}</span></p>
      )}
      {reply.status === "done" && reply.usage && (reply.usage.inputTokens || reply.usage.outputTokens) ? (
        <p className="reply__usage">{reply.usage.inputTokens ?? "?"} in · {reply.usage.outputTokens ?? "?"} out</p>
      ) : null}
    </div>
  );
}

export function ChatExperience() {
  const { transport, status, mode, setMode, providers, loading, linked, clearLinked } = useGateway();
  const { open: openConnect, notify } = useConnect();
  const demo = transport.kind === "demo";

  const [turns, setTurns] = useState<Turn[]>([]);
  const [text, setText] = useState("");
  const [plusOpen, setPlusOpen] = useState(false);
  const [attachments, setAttachments] = useState<string[]>([]);
  const [protectedOn, setProtectedOn] = useState(false);
  const [listening, setListening] = useState(false);
  const [focused, setFocused] = useState(false);
  const [compare, setCompare] = useState(false);
  const [wantedPrimary, setWantedPrimary] = useState<Choice | undefined>(() => (typeof window === "undefined" ? undefined : loadChoice()));
  const [wantedSecondary, setWantedSecondary] = useState<Choice | undefined>();

  const nextId = useRef(1);
  const controllers = useRef(new Map<number, AbortController>());

  // Coming back from a provider's authorization page: restore the conversation that was on screen.
  useEffect(() => {
    try {
      const raw = window.sessionStorage.getItem(RESUME_KEY);
      if (!raw) return;
      window.sessionStorage.removeItem(RESUME_KEY);
      const saved = JSON.parse(raw) as { turns: Turn[]; text: string };
      if (!Array.isArray(saved.turns)) return;
      nextId.current = 1 + Math.max(0, ...saved.turns.flatMap((t) => [t.id, ...t.replies.map((r) => r.id)]));
      // eslint-disable-next-line react-hooks/set-state-in-effect -- restoring persisted client-only state after hydration
      setTurns(saved.turns);
      setText(saved.text ?? "");
    } catch {
      /* storage unavailable or corrupt: start fresh */
    }
  }, []);
  const buffers = useRef(new Map<string, string>());
  const rafRef = useRef<number | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const plusWrapRef = useRef<HTMLDivElement>(null);
  const feedRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLDivElement>(null);

  const protectedMaterial = protectedOn || attachments.length > 0;
  // Returning from a provider's authorization page selects that provider (the conversation is unchanged).
  const linkedChoice = useMemo(() => {
    if (!linked?.ok) return undefined;
    const view = providers.find((p) => p.descriptor.id === linked.providerId);
    return view?.models[0] ? { providerId: view.descriptor.id, model: view.models[0].id } : undefined;
  }, [linked, providers]);
  const effectiveWanted = linkedChoice ?? wantedPrimary;
  const primary = useMemo(() => resolveChoice(providers, effectiveWanted, protectedMaterial), [providers, effectiveWanted, protectedMaterial]);
  const secondary = useMemo(() => {
    if (!compare) return undefined;
    const others = providers.filter((p) => p.descriptor.id !== primary?.providerId);
    return resolveChoice(others, wantedSecondary, protectedMaterial);
  }, [compare, providers, wantedSecondary, primary, protectedMaterial]);

  const streaming = turns.some((t) => t.replies.some((r) => r.status === "streaming"));
  const awake = focused || text.trim().length > 0 || attachments.length > 0 || plusOpen || streaming;
  const canSend = (text.trim().length > 0 || attachments.length > 0) && Boolean(primary) && !(compare && !secondary);

  // ---- feed location awareness (pinned / unread / jump-to-latest) ----------
  const pinned = useRef(true);
  const lastClientHeight = useRef(0);
  const [atBottom, setAtBottom] = useState(true);
  const [unread, setUnread] = useState(0);
  const [scrolled, setScrolled] = useState(false);

  const scrollToEnd = useCallback((behavior: ScrollBehavior = "smooth") => {
    const el = feedRef.current;
    if (!el) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    el.scrollTo({ top: el.scrollHeight, behavior: reduce ? "auto" : behavior });
  }, []);

  const onFeedScroll = useCallback(() => {
    const el = feedRef.current;
    if (!el) return;
    // A scroll event that coincides with the feed itself resizing (composer grew, keyboard opened) is
    // not the reader scrolling away; the resize observer re-pins in that case.
    if (lastClientHeight.current && el.clientHeight !== lastClientHeight.current) {
      lastClientHeight.current = el.clientHeight;
      return;
    }
    lastClientHeight.current = el.clientHeight;
    const near = el.scrollHeight - el.scrollTop - el.clientHeight < 72;
    pinned.current = near;
    setAtBottom(near);
    setScrolled(el.scrollTop > 8);
    if (near) setUnread(0);
  }, []);

  useEffect(() => {
    const feed = feedRef.current;
    const list = listRef.current;
    if (!feed) return;
    lastClientHeight.current = feed.clientHeight;
    if (turns.length === 0) return; // nothing to follow yet; keep the empty state at the top
    const observer = new ResizeObserver(() => {
      lastClientHeight.current = feed.clientHeight;
      if (pinned.current) feed.scrollTop = feed.scrollHeight;
    });
    observer.observe(feed);
    if (list) observer.observe(list);
    return () => observer.disconnect();
  }, [turns.length]);

  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const root = document.documentElement;
    const apply = () => root.style.setProperty("--vvh", `${Math.round(vv.height)}px`);
    apply();
    vv.addEventListener("resize", apply);
    vv.addEventListener("scroll", apply);
    return () => { vv.removeEventListener("resize", apply); vv.removeEventListener("scroll", apply); root.style.removeProperty("--vvh"); };
  }, []);

  useEffect(() => {
    const el = composerRef.current;
    if (!el) return;
    const apply = () => el.parentElement?.style.setProperty("--composer-h", `${el.offsetHeight}px`);
    apply();
    const observer = new ResizeObserver(apply);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [text]);

  useEffect(() => {
    if (!plusOpen) return;
    const onPointer = (event: PointerEvent) => { if (!plusWrapRef.current?.contains(event.target as Node)) setPlusOpen(false); };
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") setPlusOpen(false); };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("pointerdown", onPointer); document.removeEventListener("keydown", onKey); };
  }, [plusOpen]);

  // Abort anything in flight if the chat unmounts.
  useEffect(() => {
    const map = controllers.current;
    return () => { map.forEach((c) => c.abort()); map.clear(); };
  }, []);

  // ---- reply plumbing --------------------------------------------------------
  const patchReply = useCallback((turnId: number, replyId: number, patch: (r: Reply) => Reply) => {
    setTurns((current) => current.map((t) => (t.id !== turnId ? t : { ...t, replies: t.replies.map((r) => (r.id === replyId ? patch(r) : r)) })));
  }, []);

  const flush = useCallback((turnId: number, replyId: number) => {
    const key = `${turnId}:${replyId}`;
    const pending = buffers.current.get(key);
    if (pending) {
      buffers.current.delete(key);
      patchReply(turnId, replyId, (r) => ({ ...r, text: r.text + pending }));
    }
  }, [patchReply]);

  const queueDelta = useCallback((turnId: number, replyId: number, delta: string) => {
    const key = `${turnId}:${replyId}`;
    buffers.current.set(key, (buffers.current.get(key) ?? "") + delta);
    if (rafRef.current === null) {
      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = null;
        [...buffers.current.keys()].forEach((k) => { const [t, r] = k.split(":").map(Number); flush(t, r); });
      });
    }
  }, [flush]);

  const runReply = useCallback(async (turn: Turn, reply: Reply) => {
    const controller = new AbortController();
    controllers.current.set(reply.id, controller);
    patchReply(turn.id, reply.id, (r) => ({ ...r, text: "", status: "streaming", message: undefined, usage: undefined }));
    const finish = (patch: Partial<Reply>) => {
      flush(turn.id, reply.id);
      controllers.current.delete(reply.id);
      patchReply(turn.id, reply.id, (r) => ({ ...r, ...patch }));
      if (!pinned.current) setUnread((n) => n + 1);
    };
    try {
      const events: AsyncGenerator<StreamEvent> = transport.chat({
        providerId: reply.providerId,
        model: reply.model,
        messages: turn.messages,
        mode,
        contentClass: turn.protectedMaterial ? "protected" : "general",
        attachmentCount: turn.attachments.length,
        compareGroupId: turn.compareGroupId,
      }, controller.signal);
      let ended = false;
      for await (const evt of events) {
        if (evt.type === "delta") queueDelta(turn.id, reply.id, evt.text);
        else if (evt.type === "usage") patchReply(turn.id, reply.id, (r) => ({ ...r, usage: { inputTokens: evt.inputTokens, outputTokens: evt.outputTokens } }));
        else if (evt.type === "done") { ended = true; finish({ status: "done" }); }
        else if (evt.type === "blocked") { ended = true; finish({ status: "blocked", message: evt.reason, retryable: true }); }
        else if (evt.type === "error") { ended = true; finish({ status: evt.code === "cancelled" ? "cancelled" : "error", message: evt.message, retryable: evt.retryable }); }
      }
      if (!ended) finish({ status: controller.signal.aborted ? "cancelled" : "done" });
    } catch {
      finish({ status: "error", message: "Something went wrong reading the response.", retryable: true });
    }
  }, [transport, mode, patchReply, flush, queueDelta]);

  const stopReply = (replyId: number) => controllers.current.get(replyId)?.abort();
  const stopAll = () => controllers.current.forEach((c) => c.abort());

  function retry(turn: Turn, reply: Reply) {
    void runReply(turn, reply);
  }

  function attach(name: string) {
    setAttachments((current) => (current.includes(name) ? current : [...current, name]));
    setPlusOpen(false);
  }

  function submit(event?: FormEvent) {
    event?.preventDefault();
    if (!canSend || streaming || !primary) return;
    const prompt = text.trim() || "Review the attached material.";
    const namesFor = (c: Choice) => {
      const p = providers.find((x) => x.descriptor.id === c.providerId);
      return { providerName: providerUi(c.providerId, p?.descriptor.displayName).name, modelLabel: p?.models.find((m) => m.id === c.model)?.label ?? c.model };
    };
    const history: ChatMessage[] = turns.flatMap((t) => {
      const first = t.replies.find((r) => r.status === "done" && r.text);
      return first ? [{ role: "user" as const, content: t.prompt }, { role: "assistant" as const, content: first.text }] : [];
    });
    const sides = [primary, ...(compare && secondary ? [secondary] : [])];
    const turnId = nextId.current++;
    const turn: Turn = {
      id: turnId,
      prompt,
      attachments: [...attachments],
      protectedMaterial,
      messages: [...history, { role: "user", content: prompt }],
      compareGroupId: sides.length > 1 ? `cmp_${turnId}_${Date.now().toString(36)}` : undefined,
      replies: sides.map((c) => ({ id: nextId.current++, providerId: c.providerId, model: c.model, ...namesFor(c), text: "", status: "streaming" as const })),
    };
    saveChoice(primary);
    setTurns((current) => [...current, turn]);
    setText("");
    setAttachments([]);
    pinned.current = true;
    requestAnimationFrame(() => scrollToEnd());
    turn.replies.forEach((reply) => void runReply(turn, reply));
  }

  // Picking a provider that is not connected opens the same connect sheet as Settings, then selects it.
  function pickProvider(side: "first" | "second", providerId: string) {
    const view = providers.find((p) => p.descriptor.id === providerId);
    if (!view) return;
    const select = (c: Choice) => {
      clearLinked();
      if (side === "first") { setWantedPrimary(c); saveChoice(c); } else setWantedSecondary(c);
    };
    if (view.status !== "ready" || view.models.length === 0) {
      openConnect({
        providerId,
        onConnected: (v) => { if (v.models[0]) select({ providerId: v.descriptor.id, model: v.models[0].id }); },
        onBeforeRedirect: () => {
          try {
            const stable = turns.map((t) => ({ ...t, replies: t.replies.map((r) => (r.status === "streaming" ? { ...r, status: "cancelled" as const, message: "Interrupted while connecting." } : r)) }));
            window.sessionStorage.setItem(RESUME_KEY, JSON.stringify({ turns: stable, text }));
          } catch {
            /* ignore: the conversation just won't be restored */
          }
        },
      });
      return;
    }
    select({ providerId, model: view.models[0].id });
  }

  // Connected but blocked by policy (e.g. just linked while in Secure Local): say why, with the way out.
  const wantedView = effectiveWanted && providers.find((p) => p.descriptor.id === effectiveWanted.providerId);
  const modeNotice = wantedView && wantedView.status === "ready" && wantedView.eligibility.code === "secure_local_blocks_cloud" ? providerUi(wantedView.descriptor.id, wantedView.descriptor.displayName).name : undefined;

  // Tell the user once when they come back from a provider's authorization page.
  useEffect(() => {
    if (!linked) return;
    const name = providerUi(linked.providerId).name;
    notify(linked.ok ? `${name} connected.` : `${name} wasn’t connected. Authorization was cancelled or expired.`);
  }, [linked, notify]);

  const kicker = demo ? "Demo mode · synthetic provider" : status.state === "connected" ? `Gateway connected · ${mode === "secure_local" ? "Secure Local" : "Standard"}` : "Local Secure";
  const modeLabel = mode === "secure_local" ? "Secure Local" : "Standard";

  return (
    <section className="chat-stage">
      <div className={scrolled ? "chat-toolbar is-scrolled" : "chat-toolbar"}>
        <div className="toolbar-pair">
          <ProviderPicker
            label={compare ? "First provider" : "Provider"}
            value={primary?.providerId}
            providers={providers}
            protectedMaterial={protectedMaterial}
            demo={demo}
            onPick={(id) => pickProvider("first", id)}
          />
          <ModelPicker
            label={compare ? "First model" : "Model"}
            choice={primary}
            providers={providers}
            onChange={(c) => { clearLinked(); setWantedPrimary(c); saveChoice(c); }}
          />
        </div>
        <button
          type="button"
          className="toolbar-toggle"
          aria-pressed={compare}
          onClick={() => setCompare((v) => !v)}
          aria-label="Compare two providers side by side"
        >
          <Icon name="columns" size={16} /><span>Compare</span>
        </button>
        <button
          type="button"
          className={mode === "secure_local" ? "toolbar-toggle toolbar-toggle--mode is-secure" : "toolbar-toggle toolbar-toggle--mode"}
          aria-pressed={mode === "secure_local"}
          onClick={() => setMode(mode === "secure_local" ? "standard" : "secure_local")}
          aria-label={`Execution mode: ${modeLabel}. ${mode === "secure_local" ? "Switch to Standard, which allows connected cloud providers." : "Switch to Secure Local, which blocks all cloud providers."}`}
          title={mode === "secure_local" ? "Secure Local: cloud providers are blocked" : "Standard: connected cloud providers allowed for non-protected material"}
        >
          <Icon name={mode === "secure_local" ? "lock" : "globe"} size={16} /><span>{modeLabel}</span>
        </button>
        {compare && (
          <div className="toolbar-row">
            <span className="toolbar-row__vs">vs</span>
            <div className="toolbar-pair">
              <ProviderPicker
                label="Second provider"
                value={secondary?.providerId}
                providers={providers.filter((p) => p.descriptor.id !== primary?.providerId)}
                protectedMaterial={protectedMaterial}
                demo={demo}
                onPick={(id) => pickProvider("second", id)}
              />
              <ModelPicker
                label="Second model"
                choice={secondary}
                providers={providers}
                onChange={setWantedSecondary}
              />
            </div>
          </div>
        )}
      </div>

      {modeNotice && (
        <div className="chat-notice" role="status">
          <Icon name="lock" size={16} />
          <span>{modeNotice} is connected, but Secure Local blocks cloud providers.</span>
          <button type="button" className="btn btn--small" onClick={() => setMode("standard")}>Switch to Standard</button>
        </div>
      )}

      <div className="feed">
        <div className="conversation" ref={feedRef} onScroll={onFeedScroll} role="log" aria-live="polite" aria-relevant="additions" aria-label="Conversation">
          {turns.length === 0 ? (
            <div className="empty-chat">
              <WakeMark className="empty-chat__mark" awake={awake} working={streaming} />
              <p className="empty-kicker">{loading ? "Connecting…" : kicker}</p>
              <h1>What are we working on?</h1>
              <p className="empty-copy">
                {demo
                  ? "Ask a legal question or add documents with the + button. This public demo uses a synthetic provider; run the gateway locally to connect Claude, OpenAI, Ollama and more."
                  : "Pick a provider above, ask a question, or turn on Compare to see two providers side by side. Every call passes the policy gate first."}
              </p>
              <div className="suggestion-grid">
                {suggestions.map((s) => (
                  <button key={s} onClick={() => { setText(s); textareaRef.current?.focus(); }}>{s}<span aria-hidden="true">↗</span></button>
                ))}
              </div>
            </div>
          ) : (
            <div className="message-list" ref={listRef}>
              {turns.map((turn) => (
                <div className="turn" key={turn.id}>
                  <article className="message user">
                    <div className="message-avatar">N</div>
                    <div>
                      <span className="message-role">You</span>
                      <p>{turn.prompt}</p>
                      {(turn.attachments.length > 0 || turn.protectedMaterial) && (
                        <p className="turn__meta"><Icon name="lock" size={12} /> {turn.protectedMaterial ? "Protected material" : ""}{turn.attachments.length ? ` · ${turn.attachments.length} attachment${turn.attachments.length === 1 ? "" : "s"}` : ""}</p>
                      )}
                    </div>
                  </article>
                  {turn.replies.length === 1 ? (
                    <article className="message assistant">
                      <div className="message-avatar"><WakeMark small awake={turn.replies[0].status === "streaming"} working={turn.replies[0].status === "streaming"} /></div>
                      <ReplyBody reply={turn.replies[0]} onStop={() => stopReply(turn.replies[0].id)} onRetry={() => retry(turn, turn.replies[0])} />
                    </article>
                  ) : (
                    <div className="compare" role="group" aria-label="Side-by-side responses">
                      {turn.replies.map((reply) => (
                        <article className="reply-card" key={reply.id}>
                          <ReplyBody reply={reply} onStop={() => stopReply(reply.id)} onRetry={() => retry(turn, reply)} />
                        </article>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
        {turns.length > 0 && !atBottom && (
          <button type="button" className="jump-latest" onClick={() => { pinned.current = true; scrollToEnd(); }}>
            <Icon name="arrow-down" size={16} />
            <span>{unread > 0 ? `${unread} new ${unread === 1 ? "reply" : "replies"}` : "Jump to latest"}</span>
          </button>
        )}
      </div>

      <div className="composer-wrap" ref={composerRef}>
        <form className="composer" onSubmit={submit}>
          {attachments.length > 0 && (
            <div className="attachment-tray">
              {attachments.map((attachment) => (
                <span className="attachment-chip" key={attachment}>
                  <b>⌑</b>{attachment}
                  <button type="button" onClick={() => setAttachments((current) => current.filter((item) => item !== attachment))} aria-label={`Remove ${attachment}`}>×</button>
                </span>
              ))}
            </div>
          )}

          <textarea
            ref={textareaRef}
            value={text}
            onChange={(event) => setText(event.target.value)}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            enterKeyHint="send"
            autoComplete="off"
            autoCapitalize="sentences"
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                submit();
              }
            }}
            rows={1}
            placeholder="Ask WindSwordAI"
            aria-label="Message WindSwordAI"
          />

          <div className="composer-controls">
            <div className="composer-left">
              <div className="plus-wrap" ref={plusWrapRef}>
                <button
                  type="button"
                  className={plusOpen ? "composer-action plus active" : "composer-action plus"}
                  onClick={() => setPlusOpen((value) => !value)}
                  aria-label={plusOpen ? "Close add menu" : "Add files, photos, or matter context"}
                  aria-expanded={plusOpen}
                  aria-haspopup="menu"
                  aria-controls="windsword-add-menu"
                >+</button>
                {plusOpen && (
                  <div className="add-menu" id="windsword-add-menu" role="menu" aria-label="Add to WindSwordAI">
                    <div className="add-menu-header">Add to WindSwordAI</div>
                    {actions.map((action) => (
                      <button key={action.label} type="button" onClick={() => attach(action.attachment)} role="menuitem">
                        <span className="action-symbol">{action.symbol}</span>
                        <span><strong>{action.label}</strong><small>{action.detail}</small></span>
                      </button>
                    ))}
                    <button type="button" role="menuitemcheckbox" aria-checked={protectedOn} onClick={() => setProtectedOn((v) => !v)}>
                      <span className="action-symbol"><Icon name="lock" size={16} /></span>
                      <span><strong>Treat as protected</strong><small>{protectedOn ? "On: cloud providers are blocked" : "Off: general prompt"}</small></span>
                    </button>
                    <div className="local-foot"><span /> Protected material only goes to local providers</div>
                  </div>
                )}
              </div>
              <span className="composer-mode"><i /> {modeLabel}{protectedMaterial ? " · Protected" : ""}</span>
            </div>

            <div className="composer-right">
              <button
                type="button"
                className={listening ? "composer-action voice listening" : "composer-action voice"}
                onClick={() => setListening((value) => !value)}
                aria-label={listening ? "Stop demo voice mode" : "Start demo voice mode"}
                aria-pressed={listening}
              >
                <span className="voice-bars"><i /><i /><i /></span>
              </button>
              {streaming ? (
                <button type="button" className="send-button stop" onClick={stopAll} aria-label="Stop generating">
                  <Icon name="stop" size={18} />
                </button>
              ) : (
                <button type="submit" className="send-button" disabled={!canSend} aria-label="Send message">↑</button>
              )}
            </div>
          </div>
        </form>
        <p className="composer-caption">
          {demo ? "Synthetic demo provider. " : ""}WindSwordAI can make mistakes. Verify legal work and cited sources.
        </p>
      </div>
    </section>
  );
}
