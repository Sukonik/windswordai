import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";

const baseURL = process.env.REVIEW_BASE_URL || "http://127.0.0.1:4173";
mkdirSync("review/screenshots", { recursive: true });

const browser = await chromium.launch();

async function capture(name, options, theme, route = "/chat/", beforeShot) {
  const context = await browser.newContext(options);
  const page = await context.newPage();

  await page.addInitScript((nextTheme) => {
    localStorage.setItem("windsword-theme", nextTheme);
  }, theme);

  await page.goto(baseURL + route, { waitUntil: "networkidle" });

  if (beforeShot) {
    await beforeShot(page);
  }

  await page.screenshot({
    path: `review/screenshots/${name}.png`,
    fullPage: true,
  });

  await context.close();
}

const desktop = { viewport: { width: 1440, height: 1000 } };
const laptop = { viewport: { width: 1024, height: 768 } };
const tablet = { viewport: { width: 768, height: 1024 }, isMobile: true, hasTouch: true };
const phone390 = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true };
const phone430 = { viewport: { width: 430, height: 932 }, isMobile: true, hasTouch: true };

await capture("home-desktop-dark-1440", desktop, "dark", "/");
await capture("home-mobile-dark-390", phone390, "dark", "/");
await capture("chat-desktop-dark-1440", desktop, "dark");
await capture("chat-laptop-dark-1024", laptop, "dark");
await capture("chat-tablet-dark-768", tablet, "dark");
await capture("chat-mobile-dark-430", phone430, "dark");
await capture("chat-mobile-dark-390", phone390, "dark");
await capture("chat-mobile-light-390", phone390, "light");
await capture(
  "mobile-menu-dark-390",
  phone390,
  "dark",
  "/chat/",
  async (page) => {
    await page.getByRole("button", { name: "Open navigation menu" }).click();
    await page.waitForTimeout(280);
  }
);
await capture(
  "mobile-menu-light-390",
  phone390,
  "light",
  "/chat/",
  async (page) => {
    await page.getByRole("button", { name: "Open navigation menu" }).click();
  }
);

await browser.close();
console.log("Mobile-first review screenshots captured.");