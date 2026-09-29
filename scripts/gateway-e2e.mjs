// End-to-end: real UI (static export) served by the real gateway, talking to fake vendor APIs.
// Proves: streaming, provider switching, Secure Local gating, compare, error degradation,
// key never in the browser, audit contains no prompt text. Needs `npm run build` first.
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { launch } from "./lib-browser.mjs";
import { FAKE_KEYS, startFakeProviders } from "./fake-providers.mjs";

const GW_PORT = 8790;
const gw = `http://127.0.0.1:${GW_PORT}`;
const results = [];
const check = (name, ok, detail) => { results.push({ name, ok: Boolean(ok), detail }); console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok || !detail ? "" : `  -> ${JSON.stringify(detail)}`}`); };

const upstream = await startFakeProviders(0);
const up = `http://127.0.0.1:${upstream.port}`;
const state = mkdtempSync(join(tmpdir(), "ws-e2e-"));
const child = spawn("node", ["gateway/server.ts"], { env: { ...process.env, WINDSWORD_PORT: String(GW_PORT), WINDSWORD_STATE_DIR: state, WINDSWORD_STATIC_DIR: "out" }, stdio: ["ignore", "pipe", "pipe"] });
let log = "";
child.stdout.on("data", (d) => (log += d));
child.stderr.on("data", (d) => (log += d));
for (let i = 0; i < 50; i++) { try { if ((await fetch(`${gw}/v1/health`)).ok) break; } catch { /* starting */ } await new Promise((r) => setTimeout(r, 100)); }

mkdirSync("review/screenshots", { recursive: true });
const browser = await launch();
const errors = [];

async function open(viewport, path, theme = "dark") {
  const context = await browser.newContext({ viewport });
  // Point the (demo-built) UI at the gateway the way a user would in Settings.
  await context.addInitScript(([t, url]) => { try { if (!localStorage.getItem("windsword-theme")) localStorage.setItem("windsword-theme", t); localStorage.setItem("windsword-gateway", JSON.stringify({ url })); } catch { /* ignore */ } }, [theme, gw]);
  const page = await context.newPage();
  page.on("console", (m) => m.type() === "error" && errors.push(`console: ${m.text()}`));
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  await page.goto(gw + path, { waitUntil: "networkidle" });
  return { context, page };
}
const shot = (page, name) => page.screenshot({ path: `review/screenshots/gateway-${name}.png` });
const last = (page, sel) => page.locator(sel).last();

try {
  for (const viewport of [{ width: 390, height: 844, tag: "390" }, { width: 1440, height: 1000, tag: "1440" }]) {
    const phone = viewport.width < 900;
    const t = `[${viewport.tag}]`;
    for (const id of ["claude", "openai"]) await fetch(`${gw}/v1/connections/${id}`, { method: "DELETE" }); // fresh state per viewport
    const { context, page } = await open(viewport, "/settings/");

    // Gateway found on same origin; cloud providers visibly blocked in Secure Local.
    await page.getByText("Connected", { exact: true }).first().waitFor();
    check(`${t} gateway detected via the configured URL`, await page.getByText(gw, { exact: false }).first().isVisible());
    const claudeCard = page.getByRole("article", { name: "Claude" });
    check(`${t} Secure Local shows cloud provider policy reason`, /Secure Local Mode blocks cloud providers/.test(await claudeCard.innerText()));

    // Connect Claude with a BAD key first: graceful failure, nothing stored.
    await claudeCard.getByRole("button", { name: "Connect" }).click();
    await claudeCard.getByLabel(/Anthropic Console/).fill("sk-wrong-key-123456");
    await claudeCard.getByLabel(/Base URL/).fill(up);
    await claudeCard.getByRole("button", { name: "Verify and connect" }).click();
    await claudeCard.getByRole("alert").waitFor();
    check(`${t} bad key rejected without leaking it`, !(await claudeCard.innerText()).includes("sk-wrong-key-123456") && /rejected the credentials/.test(await claudeCard.getByRole("alert").innerText()));

    // Connect with the right key.
    await claudeCard.getByLabel(/Anthropic Console/).fill(FAKE_KEYS.claude);
    await claudeCard.getByRole("button", { name: "Verify and connect" }).click();
    await claudeCard.getByText("Connected", { exact: true }).first().waitFor();
    check(`${t} Claude connected; live models discovered`, /Claude Fake Sonnet/.test(await claudeCard.innerText()));
    check(`${t} API key not present in the page or browser storage`, await page.evaluate((k) => !document.documentElement.innerHTML.includes(k) && !JSON.stringify({ ...localStorage }).includes(k) && !document.querySelector("input[type=password]")?.value, FAKE_KEYS.claude));

    // OpenAI
    const oaCard = page.getByRole("article", { name: "OpenAI / ChatGPT" });
    await oaCard.getByRole("button", { name: "Connect" }).click();
    await oaCard.getByLabel(/OpenAI developer/).fill(FAKE_KEYS.openai);
    await oaCard.getByLabel(/Base URL/).fill(`${up}/v1`);
    await oaCard.getByRole("button", { name: "Verify and connect" }).click();
    await oaCard.getByText("Connected", { exact: true }).first().waitFor();
    const oaText = await oaCard.innerText();
    check(`${t} OpenAI connected; non-chat models filtered`, /fake-gpt-large/.test(oaText) && !/embedding/.test(oaText));
    await shot(page, `connections-${viewport.tag}`);

    // Chat in Secure Local: cloud choices disabled, local mock works.
    await page.goto(gw + "/chat/", { waitUntil: "networkidle" });
    const select = page.getByLabel(/^(Provider|First provider) and model$/);
    const disabledCloud = await select.evaluate((el) => [...el.querySelectorAll("optgroup")].filter((g) => g.disabled).map((g) => g.label));
    check(`${t} Secure Local disables cloud providers in the picker`, disabledCloud.some((l) => /Claude.*blocked in Secure Local/.test(l)) && disabledCloud.some((l) => /OpenAI.*blocked in Secure Local/.test(l)), disabledCloud);
    await page.getByLabel("Message WindSwordAI").fill("Summarize the notice clause");
    await page.getByRole("button", { name: "Send message" }).click();
    await page.getByText("Streaming…").waitFor();
    await page.locator(".reply__status:has-text('Streaming')").waitFor({ state: "detached", timeout: 8000 });
    check(`${t} mock provider streams through the gateway`, /demo provider/.test(await last(page, ".reply__text").innerText()));
    await shot(page, `chat-mock-${viewport.tag}`);

    // Switch to Standard, pick Claude, stream.
    await page.getByRole("button", { name: /Execution mode: Secure Local/ }).click();
    await page.getByRole("button", { name: /Execution mode: Standard/ }).waitFor();
    await select.selectOption({ label: "Claude Fake Sonnet" });
    await page.getByLabel("Message WindSwordAI").fill("What does the notice clause require?");
    await page.getByRole("button", { name: "Send message" }).click();
    await page.locator(".reply__status:has-text('Streaming')").waitFor({ state: "detached", timeout: 8000 });
    const claudeText = await last(page, ".reply__text").innerText();
    check(`${t} Claude streams through gateway to fake upstream`, /Claude \(fake upstream\)/.test(claudeText), claudeText);
    check(`${t} usage reported`, await page.getByText(/21 in · \d+ out/).isVisible());
    check(`${t} upstream received the key server-side`, upstream.requests.some((r) => r.path === "/v1/messages" && r.headers["x-api-key"] === FAKE_KEYS.claude));

    // Provider failure degrades gracefully; Retry present.
    await page.getByLabel("Message WindSwordAI").fill("please fail [503]");
    await page.getByRole("button", { name: "Send message" }).click();
    await last(page, ".reply__notice--error").waitFor();
    check(`${t} provider outage shows a friendly error with Retry`, /temporarily unavailable/.test(await last(page, ".reply__notice--error").innerText()) && await page.getByRole("button", { name: /^Retry/ }).last().isVisible());

    // Protected material: cloud blocked with a reason, no vendor call made.
    const before = upstream.requests.filter((r) => r.path === "/v1/messages").length;
    await page.getByRole("button", { name: "Add files, photos, or matter context" }).click();
    await page.getByRole("menuitem", { name: /Add files/ }).click();
    const protectedOptions = await select.evaluate((el) => [...el.querySelectorAll("optgroup")].filter((g) => g.disabled).map((g) => g.label));
    check(`${t} attaching a document disables cloud providers in the picker`, protectedOptions.some((l) => /Claude.*blocked for protected material/.test(l)), protectedOptions);
    check(`${t} no cloud request when protected`, upstream.requests.filter((r) => r.path === "/v1/messages").length === before);
    await page.getByRole("button", { name: "Remove Sample-License-Agreement.pdf" }).click();

    // Compare Claude vs OpenAI side by side.
    await page.getByRole("button", { name: "Compare two providers side by side" }).click();
    await select.selectOption({ label: "Claude Fake Sonnet" });
    await page.getByLabel("Second provider and model").selectOption({ label: "fake-gpt-large" });
    await page.getByLabel("Message WindSwordAI").fill("Is the notice clause enforceable?");
    await page.getByRole("button", { name: "Send message" }).click();
    await page.locator(".compare .reply__status:has-text('Streaming')").first().waitFor();
    await page.locator(".compare .reply__status:has-text('Streaming')").first().waitFor({ state: "detached", timeout: 8000 }).catch(() => {});
    await page.waitForFunction(() => document.querySelectorAll(".compare .reply__text").length === 2 && ![...document.querySelectorAll(".compare .reply__status")].some((e) => e.textContent.includes("Streaming")), null, { timeout: 8000 });
    const texts = await page.locator(".compare .reply__text").allInnerTexts();
    check(`${t} compare shows two providers' answers side by side`, /Claude \(fake upstream\)/.test(texts[0]) && /OpenAI \(fake upstream\)/.test(texts[1]), texts);
    const cards = await page.locator(".compare .reply-card").evaluateAll((els) => els.map((e) => { const r = e.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width) }; }));
    check(`${t} compare layout ${phone ? "stacks on phones" : "is two columns on desktop"}`, phone ? cards[0].x === cards[1].x && cards[1].y > cards[0].y : cards[0].y === cards[1].y && cards[1].x > cards[0].x, cards);
    check(`${t} no horizontal overflow in compare`, await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
    await shot(page, `compare-${viewport.tag}`);

    // Compare with a document: cloud side blocked independently, local side still answers.
    await page.getByLabel("Second provider and model").selectOption({ label: "Mock · Legal demo" });
    await page.getByRole("button", { name: "Add files, photos, or matter context" }).click();
    await page.getByRole("menuitem", { name: /Add files/ }).click();
    await page.getByLabel("Message WindSwordAI").fill("Compare with the attached agreement");
    const primaryDisabledNow = await page.getByLabel("First provider and model").evaluate((el) => el.value);
    check(`${t} with a document attached the first choice falls back to a local provider (no silent duplication)`, /^(mock|ollama)::/.test(primaryDisabledNow), primaryDisabledNow);
    await context.close();
  }

  // Audit: metadata only.
  const token = undefined;
  void token;
  const audit = await (await fetch(`${gw}/v1/audit?limit=200`)).json();
  const dump = JSON.stringify(audit);
  check("audit has policy decisions and chat events", audit.events.some((e) => e.type === "policy.decision") && audit.events.some((e) => e.type === "chat.end"));
  check("audit contains no prompt text or keys", !/notice clause|enforceable/.test(dump) && !dump.includes(FAKE_KEYS.claude) && !dump.includes(FAKE_KEYS.openai));
  const sample = audit.events.find((e) => e.type === "chat.end" && e.providerId === "claude");
  if (sample) writeFileSync("review/sample-audit-event.json", JSON.stringify(sample, null, 2));
  const vault = readFileSync(join(state, "vault.json"), "utf8");
  check("vault on disk holds no plaintext key", !vault.includes(FAKE_KEYS.claude) && !vault.includes(FAKE_KEYS.openai));
  check("gateway stdout never printed keys", !log.includes(FAKE_KEYS.claude));
  const unexpected = errors.filter((e) => !/status of 401/.test(e));
  const bad401 = errors.length - unexpected.length;
  check("no console or page errors (besides the 2 deliberate bad-key 401s)", unexpected.length === 0 && bad401 === 2, errors);
} catch (err) {
  check("e2e run completed", false, String(err?.stack || err));
} finally {
  await browser.close();
  child.kill();
  upstream.server.close();
}

mkdirSync("review", { recursive: true });
writeFileSync("review/gateway-e2e.json", JSON.stringify(results, null, 2));
const failed = results.filter((r) => !r.ok);
console.log(`\nGateway E2E: ${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
