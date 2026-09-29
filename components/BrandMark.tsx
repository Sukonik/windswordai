import type { CSSProperties } from "react";
import { asset } from "@/lib/assets";

/**
 * Canonical WindSwordAI artwork. These are the user-approved files, only
 * cropped/resized/converted to alpha by scripts/build-brand-assets.mjs.
 *
 * - "clean"  compact line mark for small/system UI (follows currentColor)
 * - "clean-sm" same drawing, stroke-weight lifted for <=48px (topbar)
 * - "shaded" primary shaded mark (follows currentColor)
 * - "color"  full-colour blue-steel art (01_windsword_base_enhanced_transparent)
 */
type Variant = "clean" | "clean-sm" | "shaded" | "color";

const files: Record<Variant, string> = {
  clean: "/brand/windsword-clean.webp",
  "clean-sm": "/brand/windsword-clean-sm.webp",
  shaded: "/brand/windsword-shaded.webp",
  color: "/brand/windsword-bluesteel.webp",
};

const ratio: Record<Variant, string> = {
  clean: "333 / 816",
  "clean-sm": "333 / 816",
  shaded: "646 / 816",
  color: "770 / 1242",
};

export function BrandMark({
  variant,
  className = "",
  title,
}: {
  variant: Variant;
  className?: string;
  title?: string;
}) {
  const classes = `brand-mark brand-mark--${variant} ${className}`.trim();

  if (variant === "color") {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- static export, pre-sized asset
      <img
        className={classes}
        src={asset(files.color)}
        alt={title ?? ""}
        aria-hidden={title ? undefined : true}
        width={770}
        height={1242}
        decoding="async"
        style={{ aspectRatio: ratio.color }}
      />
    );
  }

  const style = {
    "--mark": `url(${asset(files[variant])})`,
    aspectRatio: ratio[variant],
  } as CSSProperties;

  return (
    <span
      className={classes}
      style={style}
      role={title ? "img" : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
    />
  );
}
