import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";

const baseURL = process.env.REVIEW_BASE_URL || "http://127.0.0.1:4173";
mkdirSync("review/screenshots", { recursive: true });

const browser = await chromium.launch();

async function capture(name, viewport, theme) {
  const page = await browser.newPage({ viewport });
  await page.goto(baseURL + "/chat/", { waitUntil: "networkidle" });
  await page.evaluate((nextTheme) => {
    window.localStorage.setItem("windsword-theme", nextTheme);
  }, theme);
  await page.reload({ waitUntil: "networkidle" });
  await page.screenshot({ path: `review/screenshots/${name}.png`, fullPage: true });
  await page.close();
}

await capture("desktop-dark-1440", { width: 1440, height: 1000 }, "dark");
await capture("laptop-dark-1024", { width: 1024, height: 768 }, "dark");
await capture("tablet-dark-768", { width: 768, height: 1024 }, "dark");
await capture("mobile-dark-390", { width: 390, height: 844 }, "dark");
await capture("mobile-dark-360", { width: 360, height: 800 }, "dark");
await capture("desktop-light-1440", { width: 1440, height: 1000 }, "light");

await browser.close();
console.log("Review screenshots captured.");
