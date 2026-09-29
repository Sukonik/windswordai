import { chromium } from "@playwright/test";

export const baseURL = process.env.REVIEW_BASE_URL || "http://127.0.0.1:4173";

// CHROMIUM_PATH lets sandboxes with a pre-installed browser skip `playwright install`.
export function launch() {
  return chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
}

export const viewports = [
  { name: "320x740", width: 320, height: 740 },
  { name: "360x800", width: 360, height: 800 },
  { name: "390x844", width: 390, height: 844 },
  { name: "430x932", width: 430, height: 932 },
  { name: "640x900", width: 640, height: 900 },
  { name: "768x1024", width: 768, height: 1024 },
  { name: "900x900", width: 900, height: 900 },
  { name: "1024x768", width: 1024, height: 768 },
  { name: "1440x1000", width: 1440, height: 1000 },
];

export const routes = [
  { name: "home", path: "/" },
  { name: "chat", path: "/chat/" },
  { name: "about", path: "/about/" },
  { name: "matters", path: "/matters/" },
  { name: "night-studio", path: "/night-studio/" },
  { name: "settings", path: "/settings/" },
  { name: "status", path: "/status/" },
];

/** Open a page with the theme applied before first paint (persisted like a real visit). */
export async function openPage(browser, viewport, route, theme = "dark") {
  const context = await browser.newContext({ viewport: { width: viewport.width, height: viewport.height } });
  await context.addInitScript((t) => {
    try {
      if (!localStorage.getItem("windsword-theme")) localStorage.setItem("windsword-theme", t);
    } catch {}
  }, theme);
  const page = await context.newPage();
  const errors = [];
  page.on("console", (msg) => msg.type() === "error" && errors.push(`console: ${msg.text()}`));
  page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
  // Next aborts in-flight route prefetches on navigation; that is not a failure.
  page.on("requestfailed", (request) => {
    if (!/ERR_ABORTED/.test(request.failure()?.errorText ?? "")) errors.push(`requestfailed: ${request.url()}`);
  });
  page.on("response", (response) => response.status() >= 400 && errors.push(`http ${response.status()}: ${response.url()}`));
  const response = await page.goto(baseURL + route, { waitUntil: "networkidle" });
  return { context, page, errors, response };
}
