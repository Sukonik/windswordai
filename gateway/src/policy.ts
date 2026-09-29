import type { ChatRequest, ContentClass, ExecutionMode, PolicyDecision, ProviderDescriptor } from "./types.ts";

export interface PolicyContext {
  mode: ExecutionMode;
  provider: ProviderDescriptor | undefined;
  connected: boolean;
  contentClass: ContentClass;
  attachmentCount?: number;
  /** Cloud providers explicitly approved for protected material. Empty by default. */
  approvedForProtected?: ReadonlySet<string>;
}

const allow = (): PolicyDecision => ({ allow: true, code: "allowed", reason: "Allowed by policy." });
const deny = (code: PolicyDecision["code"], reason: string): PolicyDecision => ({ allow: false, code, reason });

/**
 * The single data-egress decision point. Every provider call, on every path,
 * goes through this function first. Default posture: no egress.
 */
export function decide(ctx: PolicyContext): PolicyDecision {
  const { provider } = ctx;
  if (!provider) return deny("unknown_provider", "That provider is not registered.");
  if (!provider.enabled) return deny("provider_disabled", `${provider.displayName} is disabled.`);

  const isCloud = provider.kind === "cloud";
  if (!isCloud) return allow();

  if (ctx.mode === "secure_local") {
    return deny("secure_local_blocks_cloud", `Secure Local Mode blocks cloud providers. ${provider.displayName} is not available.`);
  }
  if (!ctx.connected) {
    return deny("not_connected", `${provider.displayName} is not connected.`);
  }
  const protectedMaterial = ctx.contentClass === "protected" || (ctx.attachmentCount ?? 0) > 0;
  if (protectedMaterial && !ctx.approvedForProtected?.has(provider.id)) {
    return deny(
      "protected_content_blocks_cloud",
      `Protected or document-bearing material can only go to local or explicitly approved providers, not ${provider.displayName}.`,
    );
  }
  return allow();
}

export function decideRequest(
  req: Pick<ChatRequest, "mode" | "contentClass" | "attachmentCount">,
  provider: ProviderDescriptor | undefined,
  connected: boolean,
  approvedForProtected?: ReadonlySet<string>,
): PolicyDecision {
  return decide({
    mode: req.mode,
    provider,
    connected,
    contentClass: req.contentClass,
    attachmentCount: req.attachmentCount,
    approvedForProtected,
  });
}

/**
 * Compare / side-by-side: each provider gets its own independent decision.
 * There is no group-level shortcut, so a document can never be silently
 * duplicated to a second cloud provider.
 */
export function decideCompare(
  req: Pick<ChatRequest, "mode" | "contentClass" | "attachmentCount">,
  sides: { provider: ProviderDescriptor | undefined; connected: boolean }[],
  approvedForProtected?: ReadonlySet<string>,
): PolicyDecision[] {
  return sides.map((side) => decideRequest(req, side.provider, side.connected, approvedForProtected));
}
