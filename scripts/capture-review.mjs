// Review screenshots at the required breakpoints/routes (see docs/COLE_HANDOFF_PR02D.md).
import { mkdirSync } from "node:fs";
import { launch, openPage, viewports } from "./lib-browser.mjs";

mkdirSync("review/screenshots", { recursive: true });
const browser = await launch();
const settle = (page) => page.waitForTimeout(450);

async function shot(name, viewport, theme, route, act, fullPage = false) {
  const { context, page } = await openPage(browser, viewport, route, theme);
  if (act) await act(page);
  await settle(page);
  await page.screenshot({ path: `review/screenshots/${name}.png`, fullPage });
  await context.close();
}

const openMenu = (page) => page.getByRole("button", { name: "Open navigation menu" }).click();
const vp = Object.fromEntries(viewports.map((v) => [v.name, v]));
const phone = vp["390x844"];

// Every required width on Home + Chat, dark.
for (const v of viewports) {
  await shot(`home-dark-${v.name}`, v, "dark", "/");
  await shot(`chat-dark-${v.name}`, v, "dark", "/chat/");
}

// Required review routes, phone + desktop, both themes.
for (const [routeName, path] of [["about", "/about/"], ["matters", "/matters/"], ["night-studio", "/night-studio/"], ["settings", "/settings/"], ["status", "/status/"]]) {
  await shot(`${routeName}-dark-390x844`, phone, "dark", path);
  await shot(`${routeName}-dark-1440x1000`, vp["1440x1000"], "dark", path);
}
await shot("about-light-390x844", phone, "light", "/about/");
await shot("about-light-1440x1000", vp["1440x1000"], "light", "/about/");
await shot("about-dark-390x844-full", phone, "dark", "/about/", null, true);
await shot("about-dark-768x1024", vp["768x1024"], "dark", "/about/");

// Mobile menu + chat states.
for (const v of [vp["320x740"], phone, vp["430x932"], vp["768x1024"]]) {
  await shot(`menu-open-dark-${v.name}`, v, "dark", "/chat/", openMenu);
  await shot(`menu-open-light-${v.name}`, v, "light", "/chat/", openMenu);
}
await shot("chat-light-390x844", phone, "light", "/chat/");
await shot("chat-typing-390x844", phone, "dark", "/chat/", async (page) => {
  await page.getByLabel("Message WindSwordAI").fill("Compare the notice periods in these two agreements and flag anything unusual about termination for convenience.");
});
await shot("chat-add-menu-390x844", phone, "dark", "/chat/", (page) => page.getByRole("button", { name: "Add files, photos, or matter context" }).click());
await shot("chat-conversation-390x844", phone, "dark", "/chat/", async (page) => {
  await page.getByLabel("Message WindSwordAI").fill("Review a contract");
  await page.getByRole("button", { name: "Send message" }).click();
  await page.waitForTimeout(1000);
});
await shot("chat-light-1440x1000", vp["1440x1000"], "light", "/chat/");
await shot("home-light-390x844", phone, "light", "/");
await shot("home-light-1440x1000", vp["1440x1000"], "light", "/");

await browser.close();
console.log("Review screenshots captured.");
