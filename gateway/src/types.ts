// Provider-neutral contracts for the WindSwordAI gateway (PR 03).
// Adding a provider = descriptor + auth connector(s) + adapter + capability/policy metadata.

export type ConnectionType = "local" | "api_key" | "oauth" | "subscription" | "workspace";
export type UsageSource = "local" | "api_billing" | "subscription" | "enterprise";
export type ExecutionMode = "secure_local" | "standard";
export type ContentClass = "synthetic" | "general" | "protected";
export type ChatRole = "system" | "user" | "assistant";

export interface ChatMessage {
  role: ChatRole;
  content: string;
}

export interface ModelDescriptor {
  id: string;
  label: string;
  contextTokens?: number;
  vision?: boolean;
  tools?: boolean;
}

export interface AuthMethodDescriptor {
  type: ConnectionType;
  label: string;
  /** available: implemented here. planned: designed, not enabled. unsupported: vendor does not offer it. */
  status: "available" | "planned" | "unsupported";
  usageSource: UsageSource;
  note: string;
}

export interface ProviderDescriptor {
  id: string;
  displayName: string;
  vendor: string;
  kind: "local" | "cloud";
  /** Product priority (lower = earlier). Re-orderable without architecture changes. */
  order: number;
  enabled: boolean;
  authMethods: AuthMethodDescriptor[];
  /** Fallback list; live models are discovered on connect (capability detection). */
  suggestedModels: ModelDescriptor[];
  streaming: boolean;
  capabilities: { text: boolean; vision: boolean; tools: boolean; agent: boolean };
  /** Whether the user must supply a base URL (e.g. self-hosted or vendor-specific endpoint). */
  requiresBaseUrl?: boolean;
  defaultBaseUrl?: string;
  egress: { classification: "none" | "cloud_third_party"; retention: string };
  docsUrl?: string;
}

/** Non-secret record of a connection. Secrets live in the vault, referenced by secretRef. */
export interface Connection {
  providerId: string;
  type: ConnectionType;
  label?: string;
  baseUrl?: string;
  secretRef?: string;
  models: ModelDescriptor[];
  connectedAt: string;
}

export interface ChatRequest {
  sessionId?: string;
  providerId: string;
  model: string;
  messages: ChatMessage[];
  mode: ExecutionMode;
  contentClass: ContentClass;
  /** Number of attached documents/images. Anything > 0 counts as document-bearing. */
  attachmentCount?: number;
  /** Set when this call is one side of a compare group. */
  compareGroupId?: string;
  maxTokens?: number;
}

export type StreamEvent =
  | { type: "start"; sessionId: string; providerId: string; model: string }
  | { type: "delta"; text: string }
  | { type: "usage"; inputTokens?: number; outputTokens?: number }
  | { type: "done"; finishReason: string }
  | { type: "error"; code: ErrorCode; message: string; retryable: boolean }
  | { type: "blocked"; code: PolicyCode; reason: string };

export type ErrorCode =
  | "auth_failed"
  | "rate_limited"
  | "provider_unavailable"
  | "bad_request"
  | "network"
  | "timeout"
  | "cancelled"
  | "internal";

export interface AdapterContext {
  fetch: typeof fetch;
  baseUrl?: string;
  /** Resolves the secret at call time. Adapters never receive it from UI state. */
  getSecret: () => Promise<string | undefined>;
  /** How the resolved credential must be presented: an API key header or an OAuth bearer token. */
  credentialKind?: "api_key" | "bearer";
  signal?: AbortSignal;
}

export interface AdapterRequest {
  model: string;
  messages: ChatMessage[];
  maxTokens?: number;
}

export type AdapterEvent =
  | { type: "delta"; text: string }
  | { type: "usage"; inputTokens?: number; outputTokens?: number }
  | { type: "done"; finishReason: string };

export class ProviderError extends Error {
  code: ErrorCode;
  retryable: boolean;
  constructor(code: ErrorCode, message: string, retryable = false) {
    super(message);
    this.name = "ProviderError";
    this.code = code;
    this.retryable = retryable;
  }
}

export interface ProviderAdapter {
  descriptor: ProviderDescriptor;
  /** Capability probe: list live models (also validates credentials). */
  listModels(ctx: AdapterContext): Promise<ModelDescriptor[]>;
  stream(req: AdapterRequest, ctx: AdapterContext): AsyncGenerator<AdapterEvent>;
}

export type PolicyCode =
  | "allowed"
  | "provider_disabled"
  | "not_connected"
  | "secure_local_blocks_cloud"
  | "protected_content_blocks_cloud"
  | "unknown_provider";

export interface PolicyDecision {
  allow: boolean;
  code: PolicyCode;
  reason: string;
}

export interface ProviderView {
  descriptor: ProviderDescriptor;
  connection?: Omit<Connection, "secretRef">;
  status: "ready" | "not_connected" | "disabled" | "offline";
  models: ModelDescriptor[];
  /** Policy eligibility for the current mode, for a general (non-protected) prompt. */
  eligibility: PolicyDecision;
  /** Eligibility if the prompt is protected / document-bearing. */
  protectedEligibility: PolicyDecision;
  /** Whether delegated account linking (OAuth) is configured on this gateway for the provider. */
  oauth: { available: boolean };
}
