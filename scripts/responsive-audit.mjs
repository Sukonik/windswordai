import { chromium } from "@playwright/test";
import { writeFileSync, mkdirSync } from "node:fs";

const baseURL = process.env.REVIEW_BASE_URL || "http://127.0.0.1:4173";
const viewports = [
  { name: "mobile-360", width: 360, height: 800 },
  { name: "mobile-390", width: 390, height: 844 },
  { name: "tablet-768", width: 768, height: 1024 },
  { name: "laptop-1024", width: 1024, height: 768 },
  { name: "desktop-1440", width: 1440, height: 1000 },
];
const routes = ["/", "/chat/", "/matters/", "/night-studio/", "/status/", "/settings/"];

const browser = await chromium.launch();
const report = [];
let failed = false;

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
    const ok = Boolean(response?.ok()) && !overflow && consoleErrors.length === 0 && pageErrors.length === 0;
    if (!ok) failed = true;

    report.push({
      viewport: viewport.name,
      route,
      status: response?.status() ?? null,
      overflow,
      ...metrics,
      consoleErrors,
      pageErrors,
      ok,
    });

    if (viewport.width <= 390 && route === "/chat/") {
      const menu = page.getByRole("button", { name: "Toggle navigation" });
      await menu.click();
      const drawerOpen = await page.evaluate(() => document.body.dataset.drawerOpen === "true");
      if (!drawerOpen) {
        failed = true;
        report.push({ viewport: viewport.name, route, interaction: "drawer-open", ok: false });
      }
      await page.keyboard.press("Escape");
      const drawerClosed = await page.evaluate(() => document.body.dataset.drawerOpen !== "true");
      if (!drawerClosed) {
        failed = true;
        report.push({ viewport: viewport.name, route, interaction: "drawer-escape-close", ok: false });
      }
    }

    await page.close();
  }
}

await browser.close();

mkdirSync("review", { recursive: true });
writeFileSync("review/responsive-audit.json", JSON.stringify(report, null, 2));

if (failed) {
  console.error("Responsive QA failed. See review/responsive-audit.json");
  process.exit(1);
}

console.log(`Responsive QA passed across ${viewports.length} viewports and ${routes.length} routes.`);
