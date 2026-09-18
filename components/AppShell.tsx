"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";

const primaryNav = [
  { label: "Chat", href: "/chat", icon: "chat" },
  { label: "Matters", href: "/matters", icon: "folder" },
  { label: "Night Studio", href: "/night-studio", icon: "spark" },
] as const;

const utilityNav = [
  { label: "Status", href: "/status", icon: "pulse" },
  { label: "Settings", href: "/settings", icon: "settings" },
] as const;

const recentChats = [
  "Boardwalk license review",
  "Prior written notice research",
  "Compare contract revisions",
];

function Icon({ name }: { name: string }) {
  const common = {
    width: 18,
    height: 18,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.8,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
  };

  if (name === "chat") return <svg {...common}><path d="M7 18.5 3.5 21l1-4.2A8 8 0 1 1 7 18.5Z" /></svg>;
  if (name === "folder") return <svg {...common}><path d="M3 7.5h6l2-2h10v13H3z" /></svg>;
  if (name === "spark") return <svg {...common}><path d="m12 2 1.6 5.1L19 9l-5.4 1.9L12 16l-1.6-5.1L5 9l5.4-1.9Z" /><path d="m19 16 .8 2.4L22 19l-2.2.6L19 22l-.8-2.4L16 19l2.2-.6Z" /></svg>;
  if (name === "pulse") return <svg {...common}><path d="M3 12h4l2-5 4 10 2-5h6" /></svg>;
  if (name === "settings") return <svg {...common}><circle cx="12" cy="12" r="3" /><path d="M19 12a7 7 0 0 0-.1-1l2-1.5-2-3.4-2.5 1a7 7 0 0 0-1.8-1L14.2 3h-4.4l-.4 3.1a7 7 0 0 0-1.8 1l-2.5-1-2 3.4 2 1.5a7 7 0 0 0 0 2l-2 1.5 2 3.4 2.5-1a7 7 0 0 0 1.8 1l.4 3.1h4.4l.4-3.1a7 7 0 0 0 1.8-1l2.5 1 2-3.4-2-1.5c.1-.3.1-.7.1-1Z" /></svg>;
  if (name === "menu") return <svg {...common}><path d="M4 7h16M4 12h16M4 17h16" /></svg>;
  if (name === "sun") return <svg {...common}><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></svg>;
  return <svg {...common}><path d="M12 3v18M7 8l5-5 5 5M6 15h12" /></svg>;
}

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  useEffect(() => {
    const saved = window.localStorage.getItem("windsword-theme");
    document.documentElement.dataset.theme = saved === "light" ? "light" : "dark";
  }, []);

  function toggleTheme() {
    const current = document.documentElement.dataset.theme === "light" ? "light" : "dark";
    const next = current === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    window.localStorage.setItem("windsword-theme", next);
  }

  function NavLink({ item }: { item: { label: string; href: string; icon: string } }) {
    const active = pathname === item.href;
    return (
      <Link className={active ? "nav-link active" : "nav-link"} href={item.href} onClick={() => setSidebarOpen(false)}>
        <Icon name={item.icon} />
        <span>{item.label}</span>
      </Link>
    );
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="topbar-left">
          <button className="icon-button mobile-menu" onClick={() => setSidebarOpen((value) => !value)} aria-label="Toggle navigation" aria-expanded={sidebarOpen}>
            <Icon name="menu" />
          </button>
          <Link className="brand" href="/" aria-label="WindSwordAI home" onClick={() => setSidebarOpen(false)}>
            <span className="brand-glyph" aria-hidden="true"><span /></span>
            <span className="brand-word">WindSwordAI</span>
          </Link>
        </div>
        <div className="topbar-actions">
          <span className="secure-pill"><i /> Local Secure</span>
          <button className="icon-button theme-button" onClick={toggleTheme} aria-label="Toggle light or dark theme">
            <Icon name="sun" />
          </button>
        </div>
      </header>

      <div className="shell-body">
        <aside className={sidebarOpen ? "sidebar open" : "sidebar"}>
          <div>
            <Link className="new-chat" href="/chat">
              <span className="new-chat-plus">+</span>
              <span>New chat</span>
            </Link>

            <nav className="primary-nav" aria-label="Primary navigation">
              {primaryNav.map((item) => <NavLink key={item.href} item={item} />)}
            </nav>

            <div className="history-block">
              <p>Recent</p>
              {recentChats.map((chat) => (
                <Link href="/chat" key={chat} className="history-link" onClick={() => setSidebarOpen(false)}>{chat}</Link>
              ))}
            </div>
          </div>

          <nav className="utility-nav" aria-label="Utility navigation">
            {utilityNav.map((item) => <NavLink key={item.href} item={item} />)}
            <div className="demo-label"><span>DEMO</span> Synthetic data only</div>
          </nav>
        </aside>

        {sidebarOpen && <button className="sidebar-scrim" onClick={() => setSidebarOpen(false)} aria-label="Close navigation" />}

        <main className={pathname === "/chat" ? "content chat-content" : "content"}>
          {children}
        </main>
      </div>
    </div>
  );
}