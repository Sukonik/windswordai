import { chromium } from "@playwright/test";
import { writeFileSync, mkdirSync } from "node:fs";

const baseURL = process.env.REVIEW_BASE_URL || "http://127.0.0.1:4173";

const profiles = [
  { name: "phone-320", width: 320, height: 720, isMobile: true, hasTouch: true },
  { name: "phone-360", width: 360, height: 800, isMobile: true, hasTouch: true },
  { name: "phone-390", width: 390, height: 844, isMobile: true, hasTouch: true },
  { name: "phone-430", width: 430, height: 932, isMobile: true, hasTouch: true },
  { name: "tablet-768", width: 768, height: 1024, isMobile: true, hasTouch: true },
  { name: "laptop-1024", width: 1024, height: 768, isMobile: false, hasTouch: false },
  { name: "desktop-1440", width: 1440, height: 1000, isMobile: false, hasTouch: false },
];

const routes = ["/", "/chat/", "/matters/", "/night-studio/", "/status/", "/settings/"];

const browser = await chromium.launch();
const report = [];
let failed = false;

function record(entry) {
  report.push(entry);
  if (entry.ok === false) failed = true;
}

async function measure(page) {
  return page.evaluate(() => ({
    innerWidth: window.innerWidth,
    innerHeight: window.innerHeight,
    scrollWidth: document.documentElement.scrollWidth,
    bodyScrollWidth: document.body.scrollWidth,
    theme: document.documentElement.dataset.theme,
  }));
}

for (const profile of profiles) {
  const context = await browser.newContext({
    viewport: { width: profile.width, height: profile.height },
    isMobile: profile.isMobile,
    hasTouch: profile.hasTouch,
  });

  for (const route of routes) {
    const page = await context.newPage();
    const consoleErrors = [];
    const pageErrors = [];

    page.on("console", (msg) => {
      if (msg.type() === "error") consoleErrors.push(msg.text());
    });
    page.on("pageerror", (error) => pageErrors.push(error.message));

    const response = await page.goto(baseURL + route, { waitUntil: "networkidle" });
    const metrics = await measure(page);
    const overflow = Math.max(metrics.scrollWidth, metrics.bodyScrollWidth) > metrics.innerWidth + 1;

    record({
      profile: profile.name,
      route,
      status: response?.status() ?? null,
      overflow,
      ...metrics,
      consoleErrors,
      pageErrors,
      ok: Boolean(response?.ok()) && !overflow && consoleErrors.length === 0 && pageErrors.length === 0,
    });

    await page.close();
  }

  if (profile.isMobile && profile.width <= 430) {
    const page = await context.newPage();

    await page.addInitScript(() => {
      localStorage.setItem("windsword-theme", "dark");
    });
    await page.goto(baseURL + "/chat/", { waitUntil: "networkidle" });

    const menuButton = page.getByRole("button", { name: "Open navigation menu" });
    const themeButton = page.getByRole("button", { name: "Toggle light and dark appearance" });

    const menuBox = await menuButton.boundingBox();
    const themeBox = await themeButton.boundingBox();

    record({
      profile: profile.name,
      interaction: "touch-targets-header",
      menuBox,
      themeBox,
      ok: Boolean(
        menuBox && themeBox &&
        menuBox.width >= 44 && menuBox.height >= 44 &&
        themeBox.width >= 44 && themeBox.height >= 44
      ),
    });

    await themeButton.click();
    let theme = await page.evaluate(() => document.documentElement.dataset.theme);
    let savedTheme = await page.evaluate(() => localStorage.getItem("windsword-theme"));

    record({
      profile: profile.name,
      interaction: "header-theme-toggle-dark-to-light",
      theme,
      savedTheme,
      ok: theme === "light" && savedTheme === "light",
    });

    await page.reload({ waitUntil: "networkidle" });
    theme = await page.evaluate(() => document.documentElement.dataset.theme);

    record({
      profile: profile.name,
      interaction: "theme-persists-after-reload",
      theme,
      ok: theme === "light",
    });

    await menuButton.click();
    const sidebar = page.locator("#primary-sidebar");
    const drawerVisible = await sidebar.isVisible();
    const bodyLocked = await page.evaluate(() => document.body.dataset.drawerOpen === "true");
    const closeButton = page.getByRole("button", { name: "Close navigation menu" });
    const closeBox = await closeButton.boundingBox();

    record({
      profile: profile.name,
      interaction: "mobile-menu-open",
      drawerVisible,
      bodyLocked,
      closeBox,
      ok: drawerVisible && bodyLocked && Boolean(closeBox && closeBox.width >= 44 && closeBox.height >= 44),
    });

    const darkChoice = page.getByRole("button", { name: "Dark" });
    await darkChoice.click();
    theme = await page.evaluate(() => document.documentElement.dataset.theme);
    savedTheme = await page.evaluate(() => localStorage.getItem("windsword-theme"));

    record({
      profile: profile.name,
      interaction: "drawer-theme-choice-light-to-dark",
      theme,
      savedTheme,
      ok: theme === "dark" && savedTheme === "dark",
    });

    await page.keyboard.press("Escape");
    const lockedAfterEscape = await page.evaluate(() => document.body.dataset.drawerOpen === "true");
    const drawerAfterEscape = await sidebar.evaluate((node) => {
      const style = getComputedStyle(node);
      const rect = node.getBoundingClientRect();
      return {
        transform: style.transform,
        right: rect.right,
        left: rect.left,
      };
    });

    record({
      profile: profile.name,
      interaction: "mobile-menu-escape-close",
      lockedAfterEscape,
      drawerAfterEscape,
      ok: !lockedAfterEscape && drawerAfterEscape.right <= 1,
    });

    await menuButton.click();
    await page.getByRole("link", { name: "Matters" }).click();
    await page.waitForURL("**/matters/");
    const lockedAfterNav = await page.evaluate(() => document.body.dataset.drawerOpen === "true");

    record({
      profile: profile.name,
      interaction: "route-selection-closes-menu",
      url: page.url(),
      lockedAfterNav,
      ok: page.url().endsWith("/matters/") && !lockedAfterNav,
    });

    await page.goto(baseURL + "/chat/", { waitUntil: "networkidle" });
    const plus = page.getByRole("button", { name: "Add to chat" });
    await plus.click();
    const addMenu = page.locator(".add-menu");
    const addMenuBox = await addMenu.boundingBox();

    record({
      profile: profile.name,
      interaction: "plus-menu-within-viewport",
      addMenuBox,
      viewportWidth: profile.width,
      ok: Boolean(
        addMenuBox &&
        addMenuBox.x >= -1 &&
        addMenuBox.x + addMenuBox.width <= profile.width + 1
      ),
    });

    await page.close();
  }

  await context.close();
}

await browser.close();

mkdirSync("review", { recursive: true });
writeFileSync("review/responsive-audit.json", JSON.stringify(report, null, 2));

if (failed) {
  console.error("Mobile/responsive QA failed. See review/responsive-audit.json");
  process.exit(1);
}

console.log(`Mobile-first QA passed across ${profiles.length} device profiles and ${routes.length} routes.`);
