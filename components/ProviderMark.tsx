import { providerUi } from "@/lib/gateway/provider-ui";

/**
 * Provider badge. Uses a neutral monogram until each vendor's official mark is licensed and added
 * under public/brand/providers/. We do not redraw or approximate vendor logos.
 */
export function ProviderMark({ id, displayName, size = 28, className = "" }: { id: string; displayName?: string; size?: number; className?: string }) {
  const ui = providerUi(id, displayName);
  return (
    <span
      className={`provider-mark ${className}`.trim()}
      style={{ width: size, height: size, fontSize: Math.round(size * 0.5), ["--accent" as string]: ui.accent }}
      aria-hidden="true"
    >
      {ui.monogram}
    </span>
  );
}
