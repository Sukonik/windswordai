// Browser QA for the responsive shell. Fails CI on: overflow, console/page errors,
// broken menu, unreachable Appearance control, theme persistence, touch targets,
// focusable closed menu, hidden chat composer, or missing canonical brand art.
import { mkdirSync, writeFileSync } from "node:fs";
import { launch, openPage, viewports, routes } from "./lib-browser.mjs";

const browser = await launch();
const report = [];
const add = (entry) => report.push(entry);

const PHONE_MAX = 899; // below this the nav is a sheet

for (const viewport of viewports) {
  for (const route of routes) {
    const { context, page, errors, response } = await openPage(browser, viewport, route.path);
    const base = { viewport: viewport.name, route: route.path };

    const m = await page.evaluate(() => ({
      innerWidth: window.innerWidth,
      scrollWidth: document.documentElement.scrollWidth,
      theme: document.documentElement.dataset.theme,
    }));
    add({ ...base, check: "loads-no-errors", ok: Boolean(response?.ok()) && errors.length === 0, errors });
    add({ ...base, check: "no-horizontal-overflow", ok: m.scrollWidth <= m.innerWidth + 1, ...m });

    const brand = await page.evaluate(async () => {
      const mark = document.querySelector(".topbar .brand-mark--clean-sm");
      if (!(mark instanceof HTMLElement)) return { found: false };
      const url = getComputedStyle(mark).getPropertyValue("--mark").trim();
      const res = await fetch(url.replace(/^url\(["']?|["']?\)$/g, ""));
      const r = mark.getBoundingClientRect();
      return { found: true, fetched: res.ok, w: r.width, h: r.height };
    });
    add({ ...base, check: "canonical-compact-logo-in-topbar", ok: brand.found && brand.fetched && brand.h >= 32, brand });

    if (route.path === "/about/") {
      const imgs = await page.evaluate(() =>
        [...document.querySelectorAll(".about-layer")].map((i) => ({ src: i.currentSrc.split("/").pop(), loaded: i.complete && i.naturalWidth > 0, lazy: i.loading === "lazy" })));
      add({ ...base, check: "about-uses-canonical-art", ok: imgs.some((i) => i.src.includes("layer-base") && i.loaded), imgs });
    }

    if (route.path === "/chat/") {
      const composer = await page.evaluate(() => {
        const el = document.querySelector(".composer");
        const r = el?.getBoundingClientRect();
        return r ? { top: r.top, bottom: r.bottom, vh: window.innerHeight, left: r.left, right: r.right, vw: window.innerWidth } : null;
      });
      add({ ...base, check: "chat-composer-visible", ok: Boolean(composer) && composer.bottom <= composer.vh + 1 && composer.top >= 0 && composer.left >= 0 && composer.right <= composer.vw + 1, composer });
    }

    if (route.path === "/chat/") {
      const before = await page.evaluate(() => document.documentElement.scrollHeight <= window.innerHeight + 1);
      add({ ...base, check: "chat-page-does-not-scroll-body", ok: before });
      await page.getByRole("button", { name: "Add files, photos, or matter context" }).click();
      const menu = await page.evaluate(() => {
        const r = document.querySelector(".add-menu")?.getBoundingClientRect();
        return r ? { left: r.left, right: r.right, top: r.top, vw: window.innerWidth } : null;
      });
      add({ ...base, check: "add-menu-inside-viewport", ok: Boolean(menu) && menu.left >= 0 && menu.right <= menu.vw && menu.top >= 0, menu });
      const composerTargets = await page.evaluate(() =>
        [".composer-action.plus", ".composer-action.voice", ".send-button"].map((sel) => {
          const r = document.querySelector(sel)?.getBoundingClientRect();
          return { sel, w: Math.round(r?.width ?? 0), h: Math.round(r?.height ?? 0) };
        }));
      add({ ...base, check: "composer-touch-targets-44", ok: composerTargets.every((t) => t.w >= 44 && t.h >= 44), composerTargets });
    }

    if (viewport.width <= PHONE_MAX) {
      const menuBtn = page.getByRole("button", { name: /navigation menu/ });
      const closedFocusable = await page.evaluate(() => {
        const nav = document.getElementById("windsword-navigation");
        return nav ? getComputedStyle(nav).visibility !== "hidden" : true;
      });
      add({ ...base, check: "closed-menu-not-focusable", ok: !closedFocusable });

      const targets = await page.evaluate(() =>
        [".menu-button", ".theme-button", ".brand"].map((sel) => {
          const r = document.querySelector(sel)?.getBoundingClientRect();
          return { sel, w: Math.round(r?.width ?? 0), h: Math.round(r?.height ?? 0) };
        }));
      add({ ...base, check: "topbar-touch-targets-44", ok: targets.every((t) => t.w >= 44 && t.h >= 44), targets });

      const themeVisible = await page.locator(".theme-button").isVisible();
      add({ ...base, check: "appearance-reachable-in-topbar", ok: themeVisible });

      await menuBtn.click();
      await page.waitForFunction(() => document.body.dataset.drawerOpen === "true");
      await page.waitForTimeout(260);
      const open = await page.evaluate(() => {
        const nav = document.getElementById("windsword-navigation");
        const r = nav.getBoundingClientRect();
        const rows = [...nav.querySelectorAll(".nav-link, .new-chat, .theme-segment__option")].map((e) => {
          const b = e.getBoundingClientRect();
          return { text: e.textContent.trim(), h: Math.round(b.height), clipped: e.scrollWidth > e.clientWidth + 1 };
        });
        const foot = nav.querySelector(".sidebar__foot").getBoundingClientRect();
        return {
          left: r.left, right: r.right, vw: window.innerWidth, vh: window.innerHeight,
          bodyLocked: getComputedStyle(document.body).overflow === "hidden",
          rows, footBottom: foot.bottom, expanded: document.querySelector(".menu-button").getAttribute("aria-expanded"),
        };
      });
      add({ ...base, check: "menu-open-fits-viewport-and-locks-scroll", ok: open.left >= 0 && open.right <= open.vw + 1 && open.footBottom <= open.vh + 1 && open.bodyLocked && open.expanded === "true", open: { ...open, rows: undefined } });
      add({ ...base, check: "menu-rows-touch-size-no-clipping", ok: open.rows.every((r) => r.h >= 44 && !r.clipped), rows: open.rows.filter((r) => r.h < 44 || r.clipped) });

      // Appearance from inside the menu, then persistence across reload.
      await page.getByRole("button", { name: "Light", exact: true }).click();
      const light = await page.evaluate(() => ({ dom: document.documentElement.dataset.theme, saved: localStorage.getItem("windsword-theme"), pressed: document.querySelector('.theme-segment__option[aria-pressed="true"]')?.textContent?.trim() }));
      add({ ...base, check: "menu-appearance-switches-theme", ok: light.dom === "light" && light.saved === "light" && light.pressed === "Light", light });
      await page.getByRole("button", { name: "Close navigation", exact: true }).click();
      await page.waitForFunction(() => document.body.dataset.drawerOpen !== "true");
      add({ ...base, check: "menu-close-button", ok: true });
      await page.reload({ waitUntil: "networkidle" });
      add({ ...base, check: "theme-persists-after-reload", ok: (await page.evaluate(() => document.documentElement.dataset.theme)) === "light" });
      await page.locator(".theme-button").click();
      add({ ...base, check: "topbar-appearance-agrees-with-menu", ok: (await page.evaluate(() => document.documentElement.dataset.theme)) === "dark" });

      await menuBtn.click();
      await page.getByRole("button", { name: "Close navigation overlay" }).click({ position: { x: 2, y: 2 }, force: true }).catch(() => {});
      // On widths where the sheet covers the viewport the scrim is unreachable; Escape must still close.
      if (await page.evaluate(() => document.body.dataset.drawerOpen === "true")) await page.keyboard.press("Escape");
      await page.waitForFunction(() => document.body.dataset.drawerOpen !== "true");
      add({ ...base, check: "menu-dismiss-scrim-or-escape", ok: true });

      await menuBtn.click();
      await page.locator("#windsword-navigation").getByRole("link", { name: "Matters" }).click();
      await page.waitForURL(/\/matters\/?$/);
      const closedAfterNav = await page.evaluate(() => document.body.dataset.drawerOpen !== "true");
      add({ ...base, check: "menu-navigation-closes-menu", ok: closedAfterNav });
    } else {
      const persistent = await page.evaluate(() => {
        const nav = document.getElementById("windsword-navigation");
        const r = nav.getBoundingClientRect();
        const menu = document.querySelector(".menu-button");
        return { visible: getComputedStyle(nav).visibility === "visible" && r.width > 200, menuHidden: getComputedStyle(menu).display === "none" };
      });
      add({ ...base, check: "desktop-persistent-sidebar", ok: persistent.visible && persistent.menuHidden, persistent });
    }

    await context.close();
  }
}

await browser.close();
mkdirSync("review", { recursive: true });
writeFileSync("review/responsive-audit.json", JSON.stringify(report, null, 2));

const failures = report.filter((entry) => !entry.ok);
console.log(`Responsive QA: ${report.length - failures.length}/${report.length} checks passed`);
if (failures.length) {
  console.error(JSON.stringify(failures, null, 2));
  process.exit(1);
}
