"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { WindSwordMark } from "@/components/WindSwordMark";

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
    width: 19,
    height: 19,
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
  if (name === "close") return <svg {...common}><path d="m6 6 12 12M18 6 6 18" /></svg>;
  if (name === "sun") return <svg {...common}><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></svg>;
  if (name === "moon") return <svg {...common}><path d="M20 15.2A8 8 0 0 1 8.8 4 8.4 8.4 0 1 0 20 15.2Z" /></svg>;
  return <svg {...common}><path d="M12 3v18M7 8l5-5 5 5M6 15h12" /></svg>;
}

function applyTheme(next: "dark" | "light") {
  document.documentElement.dataset.theme = next;
  window.localStorage.setItem("windsword-theme", next);
}

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const saved = window.localStorage.getItem("windsword-theme");
    document.documentElement.dataset.theme = saved === "light" ? "light" : "dark";
  }, []);

  useEffect(() => {
    if (!sidebarOpen) {
      delete document.body.dataset.drawerOpen;
      return;
    }

    document.body.dataset.drawerOpen = "true";
    window.requestAnimationFrame(() => closeButtonRef.current?.focus());

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setSidebarOpen(false);
        window.requestAnimationFrame(() => menuButtonRef.current?.focus());
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      delete document.body.dataset.drawerOpen;
    };
  }, [sidebarOpen]);

  function closeSidebar(returnFocus = false) {
    setSidebarOpen(false);
    if (returnFocus) {
      window.requestAnimationFrame(() => menuButtonRef.current?.focus());
    }
  }

  function toggleTheme() {
    const current = document.documentElement.dataset.theme === "light" ? "light" : "dark";
    applyTheme(current === "dark" ? "light" : "dark");
  }

  function NavLink({ item }: { item: { label: string; href: string; icon: string } }) {
    const active = pathname === item.href;
    return (
      <Link
        className={active ? "nav-link active" : "nav-link"}
        href={item.href}
        aria-current={active ? "page" : undefined}
        onClick={() => closeSidebar(false)}
      >
        <span className="nav-icon"><Icon name={item.icon} /></span>
        <span>{item.label}</span>
      </Link>
    );
  }

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">Skip to workspace</a>

      <header className="topbar">
        <div className="topbar-left">
          <button
            ref={menuButtonRef}
            className="icon-button mobile-menu"
            onClick={() => setSidebarOpen((value) => !value)}
            aria-label="Open navigation menu"
            aria-expanded={sidebarOpen}
            aria-controls="primary-sidebar"
          >
            <Icon name="menu" />
          </button>

          <Link className="brand" href="/" aria-label="WindSwordAI home" onClick={() => closeSidebar(false)}>
            <WindSwordMark className="brand-sword" />
            <span className="brand-word">WindSwordAI</span>
          </Link>
        </div>

        <div className="topbar-actions">
          <span className="secure-pill" title="Local Secure mode">
            <i />
            <span>Local Secure</span>
          </span>

          <button
            className="icon-button theme-button"
            onClick={toggleTheme}
            aria-label="Toggle light and dark appearance"
            title="Toggle light / dark"
          >
            <span className="theme-icon theme-icon--sun"><Icon name="sun" /></span>
            <span className="theme-icon theme-icon--moon"><Icon name="moon" /></span>
          </button>
        </div>
      </header>

      <div className="shell-body">
        <aside
          id="primary-sidebar"
          className={sidebarOpen ? "sidebar open" : "sidebar"}
          aria-label="WindSwordAI navigation"
        >
          <div className="mobile-drawer-head">
            <Link className="mobile-drawer-brand" href="/" onClick={() => closeSidebar(false)}>
              <WindSwordMark className="mobile-drawer-sword" />
              <span>
                <strong>WindSwordAI</strong>
                <small>Workspace</small>
              </span>
            </Link>

            <button
              ref={closeButtonRef}
              className="icon-button mobile-close"
              onClick={() => closeSidebar(true)}
              aria-label="Close navigation menu"
            >
              <Icon name="close" />
            </button>
          </div>

          <div className="sidebar-scroll">
            <div className="sidebar-primary">
              <Link className="new-chat" href="/chat" onClick={() => closeSidebar(false)}>
                <span className="new-chat-plus">+</span>
                <span>New chat</span>
              </Link>

              <nav className="primary-nav" aria-label="Primary navigation">
                {primaryNav.map((item) => <NavLink key={item.href} item={item} />)}
              </nav>

              <div className="history-block">
                <p>Recent</p>
                {recentChats.map((chat) => (
                  <Link
                    href="/chat"
                    key={chat}
                    className="history-link"
                    onClick={() => closeSidebar(false)}
                  >
                    {chat}
                  </Link>
                ))}
              </div>
            </div>

            <div className="sidebar-secondary">
              <div className="mobile-appearance" aria-label="Appearance">
                <div className="mobile-appearance__label">
                  <span>Appearance</span>
                  <small>Choose what feels best on this screen.</small>
                </div>
                <div className="theme-segment" role="group" aria-label="Choose appearance">
                  <button
                    type="button"
                    className="theme-choice"
                    data-theme-choice="dark"
                    onClick={() => applyTheme("dark")}
                  >
                    <Icon name="moon" />
                    <span>Dark</span>
                  </button>
                  <button
                    type="button"
                    className="theme-choice"
                    data-theme-choice="light"
                    onClick={() => applyTheme("light")}
                  >
                    <Icon name="sun" />
                    <span>Light</span>
                  </button>
                </div>
              </div>

              <nav className="utility-nav" aria-label="Utility navigation">
                {utilityNav.map((item) => <NavLink key={item.href} item={item} />)}
              </nav>

              <div className="demo-label"><span>DEMO</span> Synthetic data only</div>
            </div>
          </div>
        </aside>

        {sidebarOpen && (
          <button
            className="sidebar-scrim"
            onClick={() => closeSidebar(false)}
            aria-label="Close navigation"
          />
        )}

        <main
          id="main-content"
          tabIndex={-1}
          className={pathname === "/chat" ? "content chat-content" : "content"}
        >
          {children}
        </main>
      </div>
    </div>
  );
}
