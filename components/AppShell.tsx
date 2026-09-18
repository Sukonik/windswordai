import Link from "next/link";
import type { ReactNode } from "react";

const navItems = [
  ["Chat", "/chat"],
  ["Matters", "/matters"],
  ["Night Studio", "/night-studio"],
  ["Status", "/status"],
  ["Settings", "/settings"],
] as const;

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="app-shell">
      <header className="topbar">
        <Link className="brand" href="/" aria-label="WindSwordAI home">
          <span className="brand-mark" aria-hidden="true">◇</span>
          <span>WindSwordAI</span>
        </Link>
        <span className="demo-badge">Demo Mode</span>
      </header>
      <div className="shell-body">
        <aside className="sidebar" aria-label="Primary navigation">
          <nav>
            {navItems.map(([label, href]) => (
              <Link key={href} href={href}>{label}</Link>
            ))}
          </nav>
          <div className="secure-note">Local-first architecture</div>
        </aside>
        <main className="content">{children}</main>
      </div>
    </div>
  );
}
