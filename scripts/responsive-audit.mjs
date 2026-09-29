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

    const brand = await page.evaluate(() => {
      const mark = document.querySelector(".topbar img.brand-mark--sapphire-sm");
      if (!(mark instanceof HTMLImageElement)) return { found: false };
      const r = mark.getBoundingClientRect();
      return { found: true, fetched: mark.complete && mark.naturalWidth > 0, w: r.width, h: r.height, src: mark.currentSrc.split("/").pop() };
    });
    add({ ...base, check: "canonical-compact-logo-in-topbar", ok: brand.found && brand.fetched && brand.h >= 28 && brand.h <= 44, brand });

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
      // Silver sword wakes to colour while the composer is in use, then settles back.
      const wakeOpacity = () => page.evaluate(() => Number(getComputedStyle(document.querySelector(".empty-chat .wake-mark__color")).opacity));
      const grayOpacity = () => page.evaluate(() => Number(getComputedStyle(document.querySelector(".empty-chat .wake-mark__gray")).opacity));
      const idle = await wakeOpacity();
      await page.getByLabel("Message WindSwordAI").focus();
      await page.waitForTimeout(500);
      const awakeOpacity = await wakeOpacity();
      await page.evaluate(() => document.activeElement?.blur());
      await page.waitForTimeout(500);
      const settled = await wakeOpacity();
      const graySettled = await grayOpacity();
      add({ ...base, check: "sword-wakes-to-colour-when-chat-in-use", ok: idle === 0 && awakeOpacity === 1 && settled === 0, idle, awakeOpacity, settled });
      add({ ...base, check: "sword-swaps-never-stacks", ok: graySettled === 1, graySettled });
      await page.getByLabel("Message WindSwordAI").focus();
      await page.waitForTimeout(500);
      const grayWhenAwake = await grayOpacity();
      add({ ...base, check: "silver-hidden-while-colour-shown", ok: grayWhenAwake === 0, grayWhenAwake });
      await page.evaluate(() => document.activeElement?.blur());
      await page.waitForTimeout(400);
      const before = await page.evaluate(() => document.documentElement.scrollHeight <= window.innerHeight + 1);
      add({ ...base, check: "chat-page-does-not-scroll-body", ok: before });
      await page.getByRole("button", { name: "Add files, photos, or matter context" }).click();
      const menu = await page.evaluate(() => {
        const r = document.querySelector(".add-menu")?.getBoundingClientRect();
        return r ? { left: r.left, right: r.right, top: r.top, vw: window.innerWidth } : null;
      });
      add({ ...base, check: "add-menu-inside-viewport", ok: Boolean(menu) && menu.left >= 0 && menu.right <= menu.vw && menu.top >= 0, menu });
      // Phones/tablets keep 44px; desktop-with-mouse uses dense 40px controls (WCAG 2.2 minimum is 24px).
      const minTarget = viewport.width >= 900 ? 40 : 44;
      const composerTargets = await page.evaluate(() =>
        [".composer-action.plus", ".composer-action.voice", ".send-button"].map((sel) => {
          const r = document.querySelector(sel)?.getBoundingClientRect();
          return { sel, w: Math.round(r?.width ?? 0), h: Math.round(r?.height ?? 0) };
        }));
      const shapes = await page.evaluate(() => ({
        circles: [".composer-action.plus", ".composer-action.voice", ".send-button", ".menu-button", ".theme-button"].map((sel) => {
          const r = document.querySelector(sel)?.getBoundingClientRect();
          return { sel, w: r?.width ?? 0, h: r?.height ?? 0 };
        }),
        chips: [...document.querySelectorAll(".suggestion-grid button")].map((b) => { const r = b.getBoundingClientRect(); return { row: Math.round(r.top), h: Math.round(r.height) }; }),
      }));
      add({ ...base, check: "round-controls-are-not-squashed", ok: shapes.circles.every((c) => Math.abs(c.w - c.h) < 0.6), shapes: shapes.circles });
      add({ ...base, check: "suggestion-chips-uniform-and-44", ok: shapes.chips.every((c) => c.h >= 44 && shapes.chips.filter((o) => o.row === c.row).every((o) => o.h === c.h)), chips: shapes.chips });
      add({ ...base, check: "composer-touch-targets-44", ok: composerTargets.every((t) => t.w >= minTarget && t.h >= minTarget), composerTargets });
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
        // The sheet scrolls as one on short phones; the footer must be reachable at the end.
        nav.scrollTop = nav.scrollHeight;
        const foot = nav.querySelector(".sidebar__foot").getBoundingClientRect();
        return {
          left: r.left, right: r.right, vw: window.innerWidth, vh: window.innerHeight,
          bodyLocked: getComputedStyle(document.body).overflow === "hidden",
          rows, footBottom: foot.bottom, expanded: document.querySelector(".menu-button").getAttribute("aria-expanded"),
        };
      });
      add({ ...base, check: "menu-open-fits-viewport-and-locks-scroll", ok: open.left >= 0 && open.right <= open.vw + 1 && open.footBottom <= open.vh + 1 && open.bodyLocked && open.expanded === "true", open: { ...open, rows: undefined } });
      add({ ...base, check: "menu-rows-touch-size-no-clipping", ok: open.rows.every((r) => r.h >= 44 && !r.clipped), rows: open.rows.filter((r) => r.h < 44 || r.clipped) });

      // Search: phone-sized field, live filtering, Escape clears before it closes the sheet.
      const searchBox = page.getByRole("searchbox", { name: "Search chats and pages" });
      const field = await searchBox.evaluate((el) => ({ font: parseFloat(getComputedStyle(el).fontSize), h: el.closest(".nav-search").getBoundingClientRect().height }));
      add({ ...base, check: "search-field-phone-sized", ok: field.font >= 16 && field.h >= 44, field });
      await searchBox.fill("matt");
      const hits = await page.locator(".search-result .search-result__label").allTextContents();
      add({ ...base, check: "search-filters-live", ok: hits.includes("Matters") && !hits.includes("Chat"), hits });
      await searchBox.fill("zzzz");
      add({ ...base, check: "search-empty-state", ok: await page.getByText("No results").isVisible() });
      await searchBox.press("Escape");
      const afterEsc = await page.evaluate(() => ({ value: document.querySelector(".nav-search input").value, open: document.body.dataset.drawerOpen === "true" }));
      add({ ...base, check: "search-escape-clears-then-keeps-sheet-open", ok: afterEsc.value === "" && afterEsc.open, afterEsc });

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

      await menuBtn.click();
      const sb = page.getByRole("searchbox", { name: "Search chats and pages" });
      await sb.fill("night");
      await sb.press("Enter");
      await page.waitForURL(/\/night-studio\/?$/);
      add({ ...base, check: "search-enter-navigates-and-closes", ok: await page.evaluate(() => document.body.dataset.drawerOpen !== "true" && document.querySelector(".nav-search input")?.value === "") });
    } else {
      const persistent = await page.evaluate(() => {
        const nav = document.getElementById("windsword-navigation");
        const r = nav.getBoundingClientRect();
        const menu = document.querySelector(".menu-button");
        return { visible: getComputedStyle(nav).visibility === "visible" && r.width > 200, menuHidden: getComputedStyle(menu).display === "none" };
      });
      add({ ...base, check: "desktop-persistent-sidebar", ok: persistent.visible && persistent.menuHidden, persistent });
      await page.keyboard.press("Control+k");
      await page.waitForTimeout(120);
      const focused = await page.evaluate(() => document.activeElement?.closest(".nav-search") !== null && document.activeElement?.tagName === "INPUT");
      const hint = await page.locator(".nav-search__hint").isVisible();
      add({ ...base, check: "desktop-search-ctrl-k-focuses-and-shows-hint", ok: focused && hint, focused, hint });
    }

    await context.close();
  }
}


// Chat feed "knows where it is": pinned to latest, jump cue when reading history, follows composer growth.
for (const viewport of [viewports.find((v) => v.name === "390x844"), { name: "390x664", width: 390, height: 664 }, viewports.find((v) => v.name === "768x1024"), viewports.find((v) => v.name === "1440x1000")]) {
  const { context, page, errors } = await openPage(browser, viewport, "/chat/");
  const base = { viewport: viewport.name, route: "/chat/" };
  const box = page.getByLabel("Message WindSwordAI");
  const dist = () => page.evaluate(() => { const f = document.querySelector(".conversation"); return f.scrollHeight - f.scrollTop - f.clientHeight; });
  const send = async (text) => { await box.fill(text); await page.getByRole("button", { name: "Send message" }).click(); };
  const waitReply = (n) => page.waitForFunction((count) => document.querySelectorAll(".message.assistant:not(.processing-message)").length >= count, n, { timeout: 5000 });

  // Send until the feed actually overflows (tall viewports need more messages), minimum 4.
  let sent = 0;
  const overflows = () => page.evaluate(() => { const f = document.querySelector(".conversation"); return f.scrollHeight > f.clientHeight + 240; });
  while (sent < 4 || (!(await overflows()) && sent < 12)) {
    sent += 1;
    await send(`Question ${sent}: please walk through the notice and termination provisions in detail.`);
    await waitReply(sent);
  }
  await page.waitForTimeout(500);
  add({ ...base, check: "feed-pinned-to-latest-after-replies", ok: (await dist()) < 80, dist: await dist() });

  await page.evaluate(() => { document.querySelector(".conversation").scrollTop = 0; });
  await page.waitForTimeout(150);
  add({ ...base, check: "feed-shows-jump-to-latest-when-scrolled-back", ok: await page.getByRole("button", { name: /Jump to latest/ }).isVisible() });

  await send("Question 5: and what about assignment?");
  await waitReply(sent + 1);
  await page.waitForTimeout(500);
  add({ ...base, check: "own-message-returns-feed-to-latest", ok: (await dist()) < 80, dist: await dist() });

  await box.fill("Question 6: summarize.");
  await page.getByRole("button", { name: "Send message" }).click();
  await page.waitForTimeout(300); // let the send-scroll settle, then go back into history before the reply lands
  await page.evaluate(() => { document.querySelector(".conversation").scrollTop = 0; });
  await waitReply(sent + 2);
  const cue = await page.getByRole("button", { name: /1 new reply/ }).isVisible();
  add({ ...base, check: "reply-while-reading-history-raises-cue-not-scroll", ok: cue && (await dist()) > 80, cue });
  await page.getByRole("button", { name: /new repl/ }).click();
  await page.waitForTimeout(600);
  add({ ...base, check: "jump-button-returns-to-latest", ok: (await dist()) < 80 && !(await page.getByRole("button", { name: /Jump to latest|new repl/ }).isVisible()) });

  await box.fill("line one\nline two\nline three\nline four\nline five");
  await page.waitForTimeout(250);
  const grown = await page.evaluate(() => { const c = document.querySelector(".composer").getBoundingClientRect(); return { bottom: c.bottom, vh: window.innerHeight, docScroll: document.documentElement.scrollHeight - window.innerHeight }; });
  add({ ...base, check: "composer-growth-keeps-feed-pinned-and-composer-visible", ok: (await dist()) < 80 && grown.bottom <= grown.vh + 1 && grown.docScroll <= 1, grown, dist: await dist() });
  add({ ...base, check: "feed-no-errors", ok: errors.length === 0, errors });
  await context.close();
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
