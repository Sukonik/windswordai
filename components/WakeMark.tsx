import { asset } from "@/lib/assets";

/**
 * Silver sword that wakes to colour while chat is in use. The two images are
 * cropped to one shared box (scripts/build-brand-assets.mjs) so they register
 * exactly; the colour layer simply fades in over the silver one.
 */
export function WakeMark({
  awake,
  working = false,
  small = false,
  className = "",
}: {
  awake: boolean;
  working?: boolean;
  small?: boolean;
  className?: string;
}) {
  const suffix = small ? "-sm" : "";
  return (
    <span
      className={`wake-mark ${className}`.trim()}
      data-awake={awake ? "true" : "false"}
      data-working={working ? "true" : "false"}
      aria-hidden="true"
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img className="wake-mark__gray" src={asset(`/brand/wake-gray${suffix}.webp`)} alt="" width={329} height={420} decoding="async" />
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img className="wake-mark__color" src={asset(`/brand/wake-color${suffix}.webp`)} alt="" width={329} height={420} decoding="async" />
    </span>
  );
}
