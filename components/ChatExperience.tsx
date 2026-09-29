"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { Icon } from "@/components/Icon";
import { useGateway } from "@/components/GatewayProvider";
import { WakeMark } from "@/components/WakeMark";
import { choiceKey, parseChoice } from "@/lib/gateway/client";
import { loadChoice, saveChoice } from "@/lib/gateway/settings";
import type { ChatMessage, ProviderView, StreamEvent } from "@/gateway/src/types";

type ReplyStatus = "streaming" | "done" | "error" | "blocked" | "cancelled";

interface Reply {
  id: number;
  providerId: string;
  model: string;
  label: string;
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

function ModelSelect({
  label, value, providers, protectedMaterial, demo, onChange, className = "",
}: {
  label: string;
  value?: Choice;
  providers: ProviderView[];
  protectedMaterial: boolean;
  demo: boolean;
  onChange: (choice: Choice) => void;
  className?: string;
}) {
  const current = value && providers.find((p) => p.descriptor.id === value.providerId);
  const currentLabel = current ? `${current.descriptor.displayName} · ${current.models.find((m) => m.id === value?.model)?.label ?? value?.model}` : "No provider available";
  return (
    <label className={`model-select ${className}`.trim()}>
      <span className="model-select__orb" aria-hidden="true" />
      <span className="model-select__text">{currentLabel}</span>
      <Icon name="chevron" size={14} />
      <select
        aria-label={label}
        value={value ? choiceKey(value.providerId, value.model) : ""}
        onChange={(event) => onChange(parseChoice(event.target.value))}
      >
        {!value && <option value="">No provider available</option>}
        {providers.map((p) => {
          const decision = protectedMaterial ? p.protectedEligibility : p.eligibility;
          const enabled = usable(p, protectedMaterial);
          let note = "";
          if (demo && p.descriptor.id !== "mock") note = " — needs gateway";
          else if (p.status === "offline") note = " — offline";
          else if (p.status === "not_connected") note = " — not connected";
          else if (!decision.allow) note = decision.code === "secure_local_blocks_cloud" ? " — blocked in Secure Local" : decision.code === "protected_content_blocks_cloud" ? " — blocked for protected material" : " — unavailable";
          else if (p.models.length === 0) note = " — no models found";
          return (
            <optgroup key={p.descriptor.id} label={`${p.descriptor.displayName}${note}`} disabled={!enabled}>
              {p.models.slice(0, 60).map((m) => (
                <option key={m.id} value={choiceKey(p.descriptor.id, m.id)} disabled={!enabled}>{m.label}</option>
              ))}
            </optgroup>
          );
        })}
      </select>
    </label>
  );
}

function ReplyBody({ reply, onStop, onRetry }: { reply: Reply; onStop: () => void; onRetry: () => void }) {
  return (
    <div className="reply__body" data-status={reply.status}>
      <div className="reply__head">
        <span className="message-role">{reply.label}</span>
        <span className="reply__status" aria-live="polite">
          {reply.status === "streaming" && "Streaming…"}
          {reply.status === "cancelled" && "Stopped"}
          {reply.status === "blocked" && "Blocked by policy"}
          {reply.status === "error" && "Failed"}
        </span>
        {reply.status === "streaming" && (
          <button type="button" className="reply__action" onClick={onStop} aria-label={`Stop ${reply.label}`}>
            <Icon name="stop" size={14} /><span>Stop</span>
          </button>
        )}
        {(reply.status === "error" || reply.status === "cancelled" || reply.status === "blocked") && reply.retryable !== false && (
          <button type="button" className="reply__action" onClick={onRetry} aria-label={`Retry ${reply.label}`}>
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
  const { transport, status, mode, setMode, providers, loading } = useGateway();
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
  const buffers = useRef(new Map<string, string>());
  const rafRef = useRef<number | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const plusWrapRef = useRef<HTMLDivElement>(null);
  const feedRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLDivElement>(null);

  const protectedMaterial = protectedOn || attachments.length > 0;
  const primary = useMemo(() => resolveChoice(providers, wantedPrimary, protectedMaterial), [providers, wantedPrimary, protectedMaterial]);
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
    const labelFor = (c: Choice) => {
      const p = providers.find((x) => x.descriptor.id === c.providerId);
      return `${p?.descriptor.displayName ?? c.providerId} · ${p?.models.find((m) => m.id === c.model)?.label ?? c.model}`;
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
      replies: sides.map((c) => ({ id: nextId.current++, providerId: c.providerId, model: c.model, label: labelFor(c), text: "", status: "streaming" as const })),
    };
    saveChoice(primary);
    setTurns((current) => [...current, turn]);
    setText("");
    setAttachments([]);
    pinned.current = true;
    requestAnimationFrame(() => scrollToEnd());
    turn.replies.forEach((reply) => void runReply(turn, reply));
  }

  const kicker = demo ? "Demo mode · synthetic provider" : status.state === "connected" ? `Gateway connected · ${mode === "secure_local" ? "Secure Local" : "Standard"}` : "Local Secure";
  const modeLabel = mode === "secure_local" ? "Secure Local" : "Standard";

  return (
    <section className="chat-stage">
      <div className={scrolled ? "chat-toolbar is-scrolled" : "chat-toolbar"}>
        <ModelSelect
          label={compare ? "First provider and model" : "Provider and model"}
          value={primary}
          providers={providers}
          protectedMaterial={protectedMaterial}
          demo={demo}
          onChange={(c) => { setWantedPrimary(c); saveChoice(c); }}
        />
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
            <ModelSelect
              label="Second provider and model"
              value={secondary}
              providers={providers.filter((p) => p.descriptor.id !== primary?.providerId)}
              protectedMaterial={protectedMaterial}
              demo={demo}
              onChange={setWantedSecondary}
            />
          </div>
        )}
      </div>

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
