"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { BrandMark } from "@/components/BrandMark";
import { Icon } from "@/components/Icon";
import { ThemeButton, ThemeSegment } from "@/components/ThemeToggle";

const primaryNav = [
  { label: "Chat", href: "/chat", icon: "chat" },
  { label: "Matters", href: "/matters", icon: "folder" },
  { label: "Night Studio", href: "/night-studio", icon: "spark" },
] as const;

const utilityNav = [
  { label: "About", href: "/about", icon: "about" },
  { label: "Status", href: "/status", icon: "pulse" },
  { label: "Settings", href: "/settings", icon: "settings" },
] as const;

const recentChats = [
  "Boardwalk license review",
  "Prior written notice research",
  "Compare contract revisions",
];

type NavItem = { label: string; href: string; icon: string };

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  // The sheet is "open for" a specific route, so navigating always closes it.
  const [openAt, setOpenAt] = useState<string | null>(null);
  const open = openAt === pathname;
  const setOpen = useCallback((value: boolean | ((current: boolean) => boolean)) => {
    setOpenAt((current) => {
      const now = current === pathname;
      const next = typeof value === "function" ? value(now) : value;
      return next ? pathname : null;
    });
  }, [pathname]);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  const close = useCallback((restoreFocus = false) => {
    setOpen(false);
    if (restoreFocus) menuButtonRef.current?.focus();
  }, [setOpen]);

  // Open sheet: lock background scroll, focus the close control, Escape closes.
  // If the viewport grows into the persistent-sidebar layout, close it too.
  useEffect(() => {
    if (!open) {
      delete document.body.dataset.drawerOpen;
      return;
    }
    document.body.dataset.drawerOpen = "true";
    closeButtonRef.current?.focus();

    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") close(true);
    };
    const wide = window.matchMedia("(min-width: 900px)");
    const onWide = () => wide.matches && setOpen(false);
    window.addEventListener("keydown", onKey);
    wide.addEventListener("change", onWide);
    return () => {
      window.removeEventListener("keydown", onKey);
      wide.removeEventListener("change", onWide);
      delete document.body.dataset.drawerOpen;
    };
  }, [open, close, setOpen]);

  function NavLink({ item }: { item: NavItem }) {
    const active = pathname === item.href || pathname === `${item.href}/`;
    return (
      <Link
        className={active ? "nav-link active" : "nav-link"}
        href={item.href}
        aria-current={active ? "page" : undefined}
      >
        <Icon name={item.icon} />
        <span>{item.label}</span>
      </Link>
    );
  }

  const isChat = pathname === "/chat" || pathname === "/chat/";

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">Skip to workspace</a>

      <header className="topbar">
        <button
          ref={menuButtonRef}
          type="button"
          className="icon-button menu-button"
          onClick={() => setOpen((value) => !value)}
          aria-label={open ? "Close navigation menu" : "Open navigation menu"}
          aria-expanded={open}
          aria-controls="windsword-navigation"
        >
          <Icon name={open ? "close" : "menu"} />
        </button>

        <Link className="brand" href="/" aria-label="WindSwordAI home">
          <BrandMark variant="clean-sm" className="brand__mark" />
          <span className="brand__word">WindSwordAI</span>
        </Link>

        <div className="topbar__spacer" />
        <span className="secure-pill"><i aria-hidden="true" /> Local Secure</span>
        <ThemeButton />
      </header>

      <div className="shell-body">
        <aside
          id="windsword-navigation"
          className={open ? "sidebar is-open" : "sidebar"}
          aria-label="WindSwordAI navigation"
          onClick={(event) => {
            // Any link tap closes the sheet, including a link to the current page.
            if ((event.target as HTMLElement).closest("a")) setOpen(false);
          }}
        >
          <div className="sidebar__head">
            <div className="sidebar__brand">
              <BrandMark variant="clean-sm" className="brand__mark" />
              <div>
                <strong>WindSwordAI</strong>
                <span><i aria-hidden="true" /> Local Secure</span>
              </div>
            </div>
            <button
              ref={closeButtonRef}
              type="button"
              className="icon-button sidebar__close"
              onClick={() => close(true)}
              aria-label="Close navigation"
            >
              <Icon name="close" />
            </button>
          </div>

          <div className="sidebar__scroll">
            <Link className="new-chat" href="/chat">
              <Icon name="plus" size={18} />
              <span>New chat</span>
            </Link>

            <nav className="nav-group" aria-label="Primary">
              {primaryNav.map((item) => <NavLink key={item.href} item={item} />)}
            </nav>

            <div className="history">
              <p className="section-label">Recent</p>
              {recentChats.map((chat) => (
                <Link href="/chat" key={chat} className="history__link">{chat}</Link>
              ))}
            </div>
          </div>

          <div className="sidebar__foot">
            <div className="sidebar__appearance">
              <p className="section-label">Appearance</p>
              <ThemeSegment />
            </div>
            <nav className="nav-group" aria-label="Utility">
              {utilityNav.map((item) => <NavLink key={item.href} item={item} />)}
            </nav>
            <p className="demo-label"><span>DEMO</span> Synthetic data only</p>
          </div>
        </aside>

        {open && (
          <button
            type="button"
            className="scrim"
            onClick={() => close(true)}
            aria-label="Close navigation overlay"
            tabIndex={-1}
          />
        )}

        <main id="main-content" tabIndex={-1} className={isChat ? "content content--chat" : "content"}>
          {children}
        </main>
      </div>
    </div>
  );
}
