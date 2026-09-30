import type { ChatRequest, ExecutionMode, PolicyDecision } from "./types.ts";

export interface AuditEvent {
  ts: string;
  /** Opaque WindSwordAI user id (never an email address). */
  userId?: string;
  type: "policy.decision" | "chat.start" | "chat.end" | "chat.error" | "connection.added" | "connection.removed" | "connection.failed" | "auth.login" | "auth.login_failed" | "auth.logout" | "setup.google_saved" | "setup.google_cleared";
  sessionId?: string;
  compareGroupId?: string;
  providerId?: string;
  model?: string;
  mode?: ExecutionMode;
  contentClass?: string;
  decision?: { allow: boolean; code: string };
  counts?: { messages: number; promptChars: number; attachments: number; replyChars?: number };
  usage?: { inputTokens?: number; outputTokens?: number };
  errorCode?: string;
  connectionType?: string;
}

/**
 * Audit sink. Events are built from a fixed allowlist of fields, so prompt text,
 * document contents and credentials cannot be logged by construction.
 */
export class AuditLog {
  private shared: { events: AuditEvent[]; sink?: (line: string) => void; max: number };
  private defaults: { userId?: string };
  constructor(sink?: (line: string) => void, max = 500, shared?: { events: AuditEvent[]; sink?: (line: string) => void; max: number }, defaults: { userId?: string } = {}) {
    this.shared = shared ?? { events: [], sink, max };
    this.defaults = defaults;
  }

  /** A view of the same log that stamps every event with a user id and only reads that user's events. */
  scoped(userId: string): AuditLog {
    return new AuditLog(undefined, 0, this.shared, { userId });
  }

  record(event: Omit<AuditEvent, "ts">): AuditEvent {
    const full: AuditEvent = { ts: new Date().toISOString(), ...this.defaults, ...event };
    this.shared.events.push(full);
    if (this.shared.events.length > this.shared.max) this.shared.events.shift();
    this.shared.sink?.(JSON.stringify(full));
    return full;
  }

  recent(limit = 50): AuditEvent[] {
    const all = this.defaults.userId ? this.shared.events.filter((e) => e.userId === this.defaults.userId) : this.shared.events;
    return all.slice(-limit);
  }
}

export function requestCounts(req: ChatRequest) {
  return {
    messages: req.messages.length,
    promptChars: req.messages.reduce((n, m) => n + m.content.length, 0),
    attachments: req.attachmentCount ?? 0,
  };
}

export function decisionSummary(d: PolicyDecision) {
  return { allow: d.allow, code: d.code };
}
