import { chromium } from "@playwright/test";
import { writeFileSync, mkdirSync } from "node:fs";

const baseURL = process.env.REVIEW_BASE_URL || "http://127.0.0.1:4173";
const viewports = [
  { name: "mobile-320", width: 320, height: 740 },
  { name: "mobile-360", width: 360, height: 800 },
  { name: "mobile-390", width: 390, height: 844 },
  { name: "mobile-430", width: 430, height: 932 },
  { name: "tablet-768", width: 768, height: 1024 },
  { name: "laptop-1024", width: 1024, height: 768 },
  { name: "desktop-1440", width: 1440, height: 1000 },
];
const routes = ["/", "/chat/", "/matters/", "/night-studio/", "/about/", "/status/", "/settings/"];

const browser = await chromium.launch();
const report = [];
let failed = false;

function add(result) {
  report.push(result);
  if (!result.ok) failed = true;
}

for (const viewport of viewports) {
  for (const route of routes) {
    const page = await browser.newPage({ viewport });
    const consoleErrors = [];
    const pageErrors = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") consoleErrors.push(msg.text());
    });
    page.on("pageerror", (error) => pageErrors.push(error.message));

    const response = await page.goto(baseURL + route, { waitUntil: "networkidle" });
    const metrics = await page.evaluate(() => ({
      innerWidth: window.innerWidth,
      scrollWidth: document.documentElement.scrollWidth,
      bodyScrollWidth: document.body.scrollWidth,
    }));

    const overflow = Math.max(metrics.scrollWidth, metrics.bodyScrollWidth) > metrics.innerWidth + 1;
    add({
      viewport: viewport.name,
      route,
      status: response?.status() ?? null,
      overflow,
      ...metrics,
      consoleErrors,
      pageErrors,
      ok: Boolean(response?.ok()) && !overflow && consoleErrors.length === 0 && pageErrors.length === 0,
    });

    if (viewport.width <= 430 && route === "/chat/") {
      await page.evaluate(() => {
        localStorage.setItem("windsword-theme", "dark");
        document.documentElement.dataset.theme = "dark";
      });

      async function isDrawerOpen() {
        return page.evaluate(() => document.body.dataset.drawerOpen === "true");
      }

      async function openDrawer() {
        if (await isDrawerOpen()) return;
        await page.getByRole("button", { name: "Open navigation menu" }).click();
      }

      async function recoverClosedDrawer() {
        if (!(await isDrawerOpen())) return;
        await page.getByRole("button", { name: "Close navigation menu" }).click();
      }

      await openDrawer();
      add({
        viewport: viewport.name,
        route,
        interaction: "drawer-open",
        ok: await isDrawerOpen(),
      });

      const drawerTheme = page.locator(".drawer-theme-button");
      await drawerTheme.click();
      const lightState = await page.evaluate(() => ({
        dom: document.documentElement.dataset.theme,
        saved: localStorage.getItem("windsword-theme"),
      }));
      add({
        viewport: viewport.name,
        route,
        interaction: "drawer-theme-dark-to-light",
        state: lightState,
        ok: lightState.dom === "light" && lightState.saved === "light",
      });

      await page.reload({ waitUntil: "networkidle" });
      const persisted = await page.evaluate(() => document.documentElement.dataset.theme);
      add({
        viewport: viewport.name,
        route,
        interaction: "theme-persists-after-reload",
        state: persisted,
        ok: persisted === "light",
      });

      const topTheme = page.getByRole("button", { name: "Change appearance: toggle light or dark theme" }).first();
      const topThemeVisible = await topTheme.isVisible();
      add({
        viewport: viewport.name,
        route,
        interaction: "topbar-theme-visible",
        ok: topThemeVisible,
      });

      const touchTargets = await page.evaluate(() => {
        const selectors = [
          ".mobile-menu",
          ".theme-button--topbar",
          ".composer-action.plus",
          ".composer-action.voice",
          ".send-button",
        ];
        return selectors.map((selector) => {
          const element = document.querySelector(selector);
          if (!(element instanceof HTMLElement)) {
            return { selector, found: false, width: 0, height: 0, ok: false };
          }
          const rect = element.getBoundingClientRect();
          return {
            selector,
            found: true,
            width: Math.round(rect.width),
            height: Math.round(rect.height),
            ok: rect.width >= 44 && rect.height >= 44,
          };
        });
      });
      add({
        viewport: viewport.name,
        route,
        interaction: "minimum-44px-touch-targets",
        targets: touchTargets,
        ok: touchTargets.every((target) => target.ok),
      });

      await topTheme.click();
      const darkState = await page.evaluate(() => ({
        dom: document.documentElement.dataset.theme,
        saved: localStorage.getItem("windsword-theme"),
      }));
      add({
        viewport: viewport.name,
        route,
        interaction: "topbar-theme-light-to-dark",
        state: darkState,
        ok: darkState.dom === "dark" && darkState.saved === "dark",
      });

      await openDrawer();
      const close = page.getByRole("button", { name: "Close navigation", exact: true });
      add({
        viewport: viewport.name,
        route,
        interaction: "drawer-close-button-visible",
        ok: await close.isVisible(),
      });
      await close.click();
      add({
        viewport: viewport.name,
        route,
        interaction: "drawer-close-button",
        ok: !(await isDrawerOpen()),
      });
      await recoverClosedDrawer();

      await openDrawer();
      await page.mouse.click(viewport.width - 8, Math.min(160, viewport.height - 20));
      add({
        viewport: viewport.name,
        route,
        interaction: "drawer-scrim-close",
        ok: !(await isDrawerOpen()),
      });
      await recoverClosedDrawer();

      await openDrawer();
      await page.keyboard.press("Escape");
      add({
        viewport: viewport.name,
        route,
        interaction: "drawer-escape-close",
        ok: !(await isDrawerOpen()),
      });
      await recoverClosedDrawer();

      await openDrawer();
      await page.getByRole("link", { name: "Matters" }).click();
      await page.waitForURL(/\/matters\/?$/);
      add({
        viewport: viewport.name,
        route,
        interaction: "drawer-navigation",
        currentURL: page.url(),
        ok: /\/matters\/?$/.test(new URL(page.url()).pathname),
      });
    }

    await page.close();
  }
}

await browser.close();

mkdirSync("review", { recursive: true });
writeFileSync("review/responsive-audit.json", JSON.stringify(report, null, 2));

if (failed) {
  const failures = report.filter((entry) => !entry.ok);
  console.error("Responsive QA failed:");
  console.error(JSON.stringify(failures, null, 2));
  console.error("See review/responsive-audit.json for the full report.");
  process.exit(1);
}

console.log(`Responsive QA passed across ${viewports.length} viewports and ${routes.length} routes, including mobile navigation + theme interactions.`);