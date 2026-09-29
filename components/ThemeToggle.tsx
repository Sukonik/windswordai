"use client";

import { Icon } from "@/components/Icon";
import { useTheme } from "@/lib/theme";

/** Topbar control: one 44px button that flips the theme. */
export function ThemeButton() {
  const { theme, setTheme } = useTheme();
  const next = theme === "dark" ? "light" : "dark";
  return (
    <button
      type="button"
      className="icon-button theme-button"
      onClick={() => setTheme(next)}
      aria-label={`Appearance: switch to ${next} theme`}
      title={`Switch to ${next} theme`}
    >
      <Icon name={theme === "dark" ? "sun" : "moon"} />
    </button>
  );
}

/** Menu control: explicit Dark / Light choice with pressed state. */
export function ThemeSegment() {
  const { theme, setTheme } = useTheme();
  return (
    <div className="theme-segment" role="group" aria-label="Appearance">
      {(["dark", "light"] as const).map((value) => (
        <button
          key={value}
          type="button"
          className="theme-segment__option"
          aria-pressed={theme === value}
          onClick={() => setTheme(value)}
        >
          <Icon name={value === "dark" ? "moon" : "sun"} size={18} />
          <span>{value === "dark" ? "Dark" : "Light"}</span>
        </button>
      ))}
    </div>
  );
}
