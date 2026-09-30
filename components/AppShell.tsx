"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";
import { BrandMark } from "@/components/BrandMark";
import { useGateway } from "@/components/GatewayProvider";
import { Icon } from "@/components/Icon";
import { LoginGate } from "@/components/LoginGate";
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

const searchIndex: (NavItem & { kind: string })[] = [
  ...primaryNav.map((item) => ({ ...item, kind: "Page" })),
  ...utilityNav.map((item) => ({ ...item, kind: "Page" })),
  ...recentChats.map((label) => ({ label, href: "/chat", icon: "chat", kind: "Recent chat" })),
];

const isMacSnapshot = () => /Mac|iPhone|iPad/.test(navigator.platform);
const noopSubscribe = () => () => {};

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
  const router = useRouter();
  const { mode, status, user, signOut } = useGateway();
  const modeLabel = mode === "secure_local" ? "Secure Local" : "Standard";
  const [query, setQuery] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);
  const isMac = useSyncExternalStore(noopSubscribe, isMacSnapshot, () => false);
  const term = query.trim().toLowerCase();
  const results = term ? searchIndex.filter((item) => item.label.toLowerCase().includes(term)) : [];
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

  // Cmd/Ctrl+K: focus search (opens the sheet first on phones/tablets).
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        if (!window.matchMedia("(min-width: 900px)").matches) setOpen(true);
        requestAnimationFrame(() => searchRef.current?.focus());
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setOpen]);

  function onSearchKeyDown(event: ReactKeyboardEvent<HTMLInputElement>) {
    if (event.key === "Escape" && query) {
      event.stopPropagation(); // clear first; a second Escape closes the sheet
      setQuery("");
    } else if (event.key === "Enter" && results[0]) {
      event.preventDefault();
      router.push(results[0].href);
      setQuery("");
      setOpen(false);
    } else if (event.key === "ArrowDown") {
      const first = document.querySelector<HTMLElement>(".search-results a");
      if (first) {
        event.preventDefault();
        first.focus();
      }
    }
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
          <BrandMark variant="sapphire-sm" className="brand__mark" />
          <span className="brand__word">WindSwordAI</span>
        </Link>

        <div className="topbar__spacer" />
        <span className="secure-pill" data-mode={mode}><i aria-hidden="true" /> {modeLabel}</span>
        <ThemeButton />
      </header>

      <div className="shell-body">
        <aside
          id="windsword-navigation"
          className={open ? "sidebar is-open" : "sidebar"}
          aria-label="WindSwordAI navigation"
          onClick={(event) => {
            // Any link tap closes the sheet, including a link to the current page.
            if ((event.target as HTMLElement).closest("a")) {
              setOpen(false);
              setQuery("");
            }
          }}
        >
          <div className="sidebar__head">
            <div className="sidebar__brand">
              <BrandMark variant="sapphire-sm" className="brand__mark" />
              <div>
                <strong>WindSwordAI</strong>
                <span><i aria-hidden="true" /> {modeLabel}</span>
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
            <form className="nav-search" role="search" onSubmit={(event) => event.preventDefault()}>
              <Icon name="search" size={18} />
              <input
                ref={searchRef}
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={onSearchKeyDown}
                placeholder="Search"
                aria-label="Search chats and pages"
                enterKeyHint="search"
                autoComplete="off"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
              />
              {query ? (
                <button type="button" className="nav-search__clear" aria-label="Clear search" onClick={() => { setQuery(""); searchRef.current?.focus(); }}>
                  <Icon name="close" size={16} />
                </button>
              ) : (
                <kbd className="nav-search__hint" aria-hidden="true">{isMac ? "⌘K" : "Ctrl K"}</kbd>
              )}
            </form>

            {term ? (
              <div className="search-results" role="region" aria-label="Search results" aria-live="polite">
                <p className="section-label">{results.length ? `${results.length} ${results.length === 1 ? "result" : "results"}` : "No results"}</p>
                {results.map((item) => (
                  <Link key={`${item.kind}-${item.label}`} href={item.href} className="search-result">
                    <Icon name={item.icon} size={18} />
                    <span className="search-result__label">{item.label}</span>
                    <small>{item.kind}</small>
                  </Link>
                ))}
                {!results.length && <p className="search-empty">Nothing matches “{query.trim()}”. Try a page name like Matters, or a recent chat.</p>}
              </div>
            ) : (
              <>
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
              </>
            )}
          </div>

          <div className="sidebar__foot">
            {user && (
              <div className="account">
                <span className="account__avatar" aria-hidden="true">{(user.name ?? user.email).slice(0, 1).toUpperCase()}</span>
                <div className="account__meta">
                  <strong>{user.name ?? user.email}</strong>
                  <small>{user.email}</small>
                </div>
                <button type="button" className="btn btn--small" onClick={() => { close(); void signOut(); }}>Sign out</button>
              </div>
            )}
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
          {status.state === "login_required" ? <LoginGate url={status.url} googleConfigured={status.googleConfigured} /> : children}
        </main>
      </div>
    </div>
  );
}
