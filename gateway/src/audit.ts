import type { ChatRequest, ExecutionMode, PolicyDecision } from "./types.ts";

export interface AuditEvent {
  ts: string;
  type: "policy.decision" | "chat.start" | "chat.end" | "chat.error" | "connection.added" | "connection.removed";
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
  private events: AuditEvent[] = [];
  private sink?: (line: string) => void;
  private max: number;
  constructor(sink?: (line: string) => void, max = 500) {
    this.sink = sink;
    this.max = max;
  }

  record(event: Omit<AuditEvent, "ts">): AuditEvent {
    const full: AuditEvent = { ts: new Date().toISOString(), ...event };
    this.events.push(full);
    if (this.events.length > this.max) this.events.shift();
    this.sink?.(JSON.stringify(full));
    return full;
  }

  recent(limit = 50): AuditEvent[] {
    return this.events.slice(-limit);
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
