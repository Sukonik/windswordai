type WindSwordMarkProps = {
  className?: string;
  title?: string;
  mono?: boolean;
};

export function WindSwordMark({
  className = "",
  title,
  mono = false,
}: WindSwordMarkProps) {
  const classes = ["windsword-mark", mono ? "windsword-mark--mono" : "", className]
    .filter(Boolean)
    .join(" ");

  return (
    <svg
      className={classes}
      viewBox="0 0 128 160"
      role={title ? "img" : undefined}
      aria-hidden={title ? undefined : true}
      focusable="false"
    >
      {title ? <title>{title}</title> : null}

      <g className="windsword-mark__wing windsword-mark__wing--left">
        <path d="M55 51C43 48 31 42 18 30c11 3 19 1 27-7-1 9 3 17 12 23Z" />
        <path d="M50 52C38 52 26 47 13 38c12 1 21-2 28-8 0 8 4 15 12 20Z" />
        <path d="M48 56C36 59 26 56 16 51c10-2 18-6 24-12 2 7 6 12 13 15Z" />
        <path className="windsword-mark__feather" d="M42 35 25 29M44 41 24 39M46 47 28 48" />
      </g>

      <g className="windsword-mark__wing windsword-mark__wing--right">
        <path d="M73 51c12-3 24-9 37-21-11 3-19 1-27-7 1 9-3 17-12 23Z" />
        <path d="M78 52c12 0 24-5 37-14-12 1-21-2-28-8 0 8-4 15-12 20Z" />
        <path d="M80 56c12 3 22 0 32-5-10-2-18-6-24-12-2 7-6 12-13 15Z" />
        <path className="windsword-mark__feather" d="m86 35 17-6M84 41l20-2M82 47l18 1" />
      </g>

      <path
        className="windsword-mark__pommel"
        d="M57 24c-5-5-6-13-2-20 2 6 5 9 9 10 4-1 7-4 9-10 4 7 3 15-2 20l-7 5Z"
      />
      <rect className="windsword-mark__grip" x="57" y="22" width="14" height="28" rx="5" />
      <path className="windsword-mark__wrap" d="m58 28 12 6M58 36l12 6M59 44l9 5" />

      <path
        className="windsword-mark__guard"
        d="M46 52c5-7 11-10 18-10s13 3 18 10l-8 17c-4-3-7-4-10-4s-6 1-10 4Z"
      />
      <circle className="windsword-mark__gem-ring" cx="64" cy="55" r="10" />
      <circle className="windsword-mark__gem" cx="64" cy="55" r="6" />

      <path className="windsword-mark__blade-outer" d="M50 65h28l-4 60-10 29-10-29Z" />
      <path className="windsword-mark__blade" d="M57 70h14l-3 52-4 17-4-17Z" />
      <path className="windsword-mark__blade-light" d="M60 72h4l-2 56-2 5Z" />
      <path className="windsword-mark__blade-edge" d="M76 68 71 124 64 145 57 124 52 68" />
    </svg>
  );
}
