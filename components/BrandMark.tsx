import type { CSSProperties } from "react";
import { asset } from "@/lib/assets";

/**
 * Canonical WindSwordAI artwork. These are the user-approved files, only
 * cropped/resized/converted to alpha by scripts/build-brand-assets.mjs.
 *
 * - "sapphire-sm" header size of the sapphire art; "gray" silver sword for the chat surface
 * - "line"   bold white/black-outline line sword from the icon pack: the header/system mark (28-40px)
 * - "sapphire" full-colour primary from the icon pack: hero, social
 * - "clean"  compact line mark for small/system UI (follows currentColor)
 * - "clean-sm" same drawing, stroke-weight lifted for <=48px (topbar)
 * - "shaded" primary shaded mark (follows currentColor)
 * - "color"  full-colour blue-steel art (01_windsword_base_enhanced_transparent)
 */
type Variant = "gray" | "sapphire-sm" | "line" | "clean" | "clean-sm" | "shaded" | "color" | "sapphire";

const files: Record<Variant, string> = {
  gray: "/brand/windsword-gray.webp",
  "sapphire-sm": "/brand/windsword-sapphire-sm.webp",
  line: "/brand/windsword-line.webp",
  sapphire: "/brand/windsword-sapphire.webp",
  clean: "/brand/windsword-clean.webp",
  "clean-sm": "/brand/windsword-clean-sm.webp",
  shaded: "/brand/windsword-shaded.webp",
  color: "/brand/windsword-bluesteel.webp",
};

const ratio: Record<Variant, string> = {
  gray: "126 / 160",
  "sapphire-sm": "876 / 1200",
  line: "114 / 160",
  sapphire: "876 / 1200",
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

  if (variant === "color" || variant === "sapphire" || variant === "sapphire-sm" || variant === "line" || variant === "gray") {
    const dims = variant === "line" ? [114, 160] : variant === "gray" ? [126, 160] : variant === "sapphire" || variant === "sapphire-sm" ? [876, 1200] : [770, 1242];
    return (
      // eslint-disable-next-line @next/next/no-img-element -- static export, pre-sized asset
      <img
        className={classes}
        src={asset(files[variant])}
        alt={title ?? ""}
        aria-hidden={title ? undefined : true}
        width={dims[0]}
        height={dims[1]}
        decoding="async"
        style={{ aspectRatio: ratio[variant] }}
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
