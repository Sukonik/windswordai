"use client";

import { useMemo, useRef, useState, type FormEvent } from "react";

type Message = {
  id: number;
  role: "user" | "assistant";
  text: string;
};

const actions = [
  { label: "Add photos", detail: "PNG, JPG, TIFF", symbol: "▧", attachment: "Site-photo.jpg" },
  { label: "Add files", detail: "PDF, DOCX, XLSX + more", symbol: "⌑", attachment: "Sample-License-Agreement.pdf" },
  { label: "Add from matter", detail: "Choose a secure workspace", symbol: "◇", attachment: "Matter: Boardwalk License Review" },
  { label: "Recent documents", detail: "Your latest local files", symbol: "↺", attachment: "Sample-Council-Memo.docx" },
];

const suggestions = [
  "Review a contract",
  "Compare two documents",
  "Build a case timeline",
  "Summarize a matter",
];

export function ChatExperience() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [text, setText] = useState("");
  const [plusOpen, setPlusOpen] = useState(false);
  const [attachments, setAttachments] = useState<string[]>([]);
  const [effort, setEffort] = useState("High");
  const [processing, setProcessing] = useState(false);
  const [listening, setListening] = useState(false);
  const nextId = useRef(1);

  const canSend = useMemo(() => text.trim().length > 0 || attachments.length > 0, [text, attachments]);

  function attach(name: string) {
    setAttachments((current) => current.includes(name) ? current : [...current, name]);
    setPlusOpen(false);
  }

  function submit(event?: FormEvent) {
    event?.preventDefault();
    if (!canSend || processing) return;

    const prompt = text.trim() || "Review the attached material.";
    const currentAttachments = [...attachments];
    const userId = nextId.current++;
    setMessages((current) => [...current, { id: userId, role: "user", text: prompt }]);
    setText("");
    setAttachments([]);
    setProcessing(true);

    window.setTimeout(() => {
      const sourceNote = currentAttachments.length
        ? ` I can see ${currentAttachments.length} synthetic attachment${currentAttachments.length === 1 ? "" : "s"} in this demo.`
        : "";
      setMessages((current) => [
        ...current,
        {
          id: nextId.current++,
          role: "assistant",
          text: `This is the PR 02 interface demo, so no model or legal document has been contacted yet.${sourceNote} The next runtime PR will connect this exact experience to the secure provider gateway.`,
        },
      ]);
      setProcessing(false);
    }, 720);
  }

  return (
    <section className="chat-stage">
      <div className="chat-toolbar">
        <button className="mode-button" type="button">
          <span className="mode-orb" />
          <span>WindSword</span>
          <span className="mode-divider" />
          <span>{effort}</span>
          <span className="chevron">⌄</span>
          <select aria-label="Reasoning effort" value={effort} onChange={(event) => setEffort(event.target.value)}>
            <option>High</option>
            <option>Balanced</option>
            <option>Fast</option>
          </select>
        </button>
        <span className="workspace-context">No matter selected</span>
      </div>

      <div className="conversation" aria-live="polite">
        {messages.length === 0 ? (
          <div className="empty-chat">
            <div className="wind-emblem" aria-hidden="true">
              <span className="blade-line blade-a" />
              <span className="blade-line blade-b" />
              <span className="blade-core" />
            </div>
            <p className="empty-kicker">Local Secure · Demo Mode</p>
            <h1>What are we working on?</h1>
            <p className="empty-copy">
              Ask a legal question, draft from context, or add documents with the + button.
              This first visual build uses synthetic data and no external AI.
            </p>
            <div className="suggestion-grid">
              {suggestions.map((suggestion) => (
                <button key={suggestion} onClick={() => setText(suggestion)}>{suggestion}<span>↗</span></button>
              ))}
            </div>
          </div>
        ) : (
          <div className="message-list">
            {messages.map((message) => (
              <article key={message.id} className={`message ${message.role}`}>
                <div className="message-avatar">{message.role === "assistant" ? "W" : "N"}</div>
                <div>
                  <span className="message-role">{message.role === "assistant" ? "WindSwordAI" : "You"}</span>
                  <p>{message.text}</p>
                </div>
              </article>
            ))}
            {processing && (
              <article className="message assistant processing-message">
                <div className="message-avatar processing-avatar"><span /></div>
                <div>
                  <span className="message-role">WindSwordAI</span>
                  <div className="thinking-line"><i /><i /><i /></div>
                </div>
              </article>
            )}
          </div>
        )}
      </div>

      <div className="composer-wrap">
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
            value={text}
            onChange={(event) => setText(event.target.value)}
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
              <div className="plus-wrap">
                <button type="button" className={plusOpen ? "composer-action plus active" : "composer-action plus"} onClick={() => setPlusOpen((value) => !value)} aria-label="Add to chat" aria-expanded={plusOpen}>+</button>
                {plusOpen && (
                  <div className="add-menu" role="menu">
                    <div className="add-menu-header">Add to WindSwordAI</div>
                    {actions.map((action) => (
                      <button key={action.label} type="button" onClick={() => attach(action.attachment)} role="menuitem">
                        <span className="action-symbol">{action.symbol}</span>
                        <span><strong>{action.label}</strong><small>{action.detail}</small></span>
                      </button>
                    ))}
                    <div className="local-foot"><span /> Files stay local in Secure Mode</div>
                  </div>
                )}
              </div>
              <span className="composer-mode"><i /> Secure</span>
            </div>

            <div className="composer-right">
              <button
                type="button"
                className={listening ? "composer-action voice listening" : "composer-action voice"}
                onClick={() => setListening((value) => !value)}
                aria-label={listening ? "Stop demo voice mode" : "Start demo voice mode"}
              >
                <span className="voice-bars"><i /><i /><i /></span>
              </button>
              <button type="submit" className={processing ? "send-button processing" : "send-button"} disabled={!canSend || processing} aria-label="Send message">
                {processing ? <span className="wake-dot" /> : "↑"}
              </button>
            </div>
          </div>
        </form>
        <p className="composer-caption">
          WindSwordAI can make mistakes. Verify legal work and cited sources.
        </p>
      </div>
    </section>
  );
}
