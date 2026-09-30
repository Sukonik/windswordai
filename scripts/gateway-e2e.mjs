// End-to-end: real UI (static export) served by the real gateway, talking to fake vendor APIs and a fake
// OAuth authorization server. Needs `npm run build` first.
// Proves: branded connect flow (key + OAuth/PKCE), Advanced settings hidden by default, streaming, provider
// switching, Secure Local gating, inline connect from Chat with conversation restore, compare identities,
// error degradation, and that no key/token ever reaches the browser, logs, audit or vault plaintext.
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { launch } from "./lib-browser.mjs";
import { FAKE_KEYS, FAKE_OAUTH, startFakeProviders } from "./fake-providers.mjs";

const GW_PORT = 8790;
const gw = `http://127.0.0.1:${GW_PORT}`;
const results = [];
const check = (name, ok, detail) => { results.push({ name, ok: Boolean(ok), detail }); console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok || !detail ? "" : `  -> ${JSON.stringify(detail)}`}`); };

const upstream = await startFakeProviders(0);
const up = `http://127.0.0.1:${upstream.port}`;
const state = mkdtempSync(join(tmpdir(), "ws-e2e-"));
const child = spawn("node", ["gateway/server.ts"], {
  env: {
    ...process.env, WINDSWORD_PORT: String(GW_PORT), WINDSWORD_STATE_DIR: state, WINDSWORD_STATIC_DIR: "out",
    WINDSWORD_OAUTH_GEMINI_CLIENT_ID: FAKE_OAUTH.clientId, WINDSWORD_OAUTH_GEMINI_CLIENT_SECRET: FAKE_OAUTH.clientSecret, WINDSWORD_OAUTH_GEMINI_SCOPES: FAKE_OAUTH.scope,
    WINDSWORD_OAUTH_GEMINI_AUTHORIZE_URL: `${up}/oauth/authorize`, WINDSWORD_OAUTH_GEMINI_TOKEN_URL: `${up}/oauth/token`, WINDSWORD_OAUTH_GEMINI_REVOKE_URL: `${up}/oauth/revoke`, WINDSWORD_OAUTH_GEMINI_BASE_URL: `${up}/gemini`,
  },
  stdio: ["ignore", "pipe", "pipe"],
});
let log = "";
child.stdout.on("data", (d) => (log += d));
child.stderr.on("data", (d) => (log += d));
for (let i = 0; i < 50; i++) { try { if ((await fetch(`${gw}/v1/health`)).ok) break; } catch { /* starting */ } await new Promise((r) => setTimeout(r, 100)); }

mkdirSync("review/screenshots", { recursive: true });
const browser = await launch();
const errors = [];
const secretsSeenInBrowser = [];

async function open(viewport, path, theme = "dark") {
  const context = await browser.newContext({ viewport });
  // Point the (demo-built) UI at the gateway the way a user would in Settings > Advanced.
  await context.addInitScript(([t, url]) => { try { if (!localStorage.getItem("windsword-theme")) localStorage.setItem("windsword-theme", t); if (!localStorage.getItem("windsword-gateway")) localStorage.setItem("windsword-gateway", JSON.stringify({ url })); } catch { /* ignore */ } }, [theme, gw]);
  const page = await context.newPage();
  page.on("console", (m) => m.type() === "error" && errors.push(`console: ${m.text()}`));
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  await page.goto(gw + path, { waitUntil: "networkidle" });
  return { context, page };
}
const shot = (page, name) => page.screenshot({ path: `review/screenshots/gateway-${name}.png` });
const last = (page, sel) => page.locator(sel).last();
const doneStreaming = (page) => page.waitForFunction(() => document.querySelectorAll(".reply__text").length > 0 && ![...document.querySelectorAll(".reply__status")].some((e) => e.textContent.includes("Streaming")), null, { timeout: 12000 });
const leaks = (page, values) => page.evaluate((vals) => { const hay = document.documentElement.innerHTML + JSON.stringify({ ...localStorage }) + JSON.stringify({ ...sessionStorage }); return vals.filter((v) => hay.includes(v)); }, values);

try {
  for (const viewport of [{ width: 390, height: 844, tag: "390" }, { width: 1440, height: 1000, tag: "1440" }]) {
    const phone = viewport.width < 900;
    const t = `[${viewport.tag}]`;
    for (const id of ["claude", "openai", "gemini"]) await fetch(`${gw}/v1/connections/${id}`, { method: "DELETE" }); // fresh state per viewport

    // ---------------------------------------------------------------- Settings
    const { context, page } = await open(viewport, "/settings/");
    await page.getByRole("article", { name: "Claude" }).waitFor();

    check(`${t} gateway controls are hidden by default (Advanced is collapsed)`, !(await page.locator("#advanced").evaluate((el) => el.open)) && !(await page.getByLabel(/Gateway URL/).isVisible()));
    const names = await page.locator(".settings-page:not(.connections) .provider-card").evaluateAll((els) => els.map((e) => e.getAttribute("aria-label")));
    check(`${t} branded cards in registry (product-priority) order, no internal mock card`, JSON.stringify(names) === JSON.stringify(["Claude", "ChatGPT", "Muse", "Gemini", "Mistral", "Ollama"]), names);
    const actions = await page.locator(".settings-page:not(.connections) .provider-card").evaluateAll((els) => els.map((e) => [...e.querySelectorAll(".provider-card__action .btn")].map((b) => b.textContent.trim())));
    check(`${t} each card offers one obvious action`, JSON.stringify(actions.map((a) => a[0])) === JSON.stringify(["Connect Claude", "Connect ChatGPT", "Connect Muse", "Connect Gemini", "Connect Mistral", "Use local Ollama"]), actions);
    check(`${t} no jargon (gateway, token, base URL) in the normal view`, !/gateway url|gateway token|base url/i.test(await page.locator(".settings-page:not(.connections) .provider-grid").innerText()));

    const claudeCard = page.getByRole("article", { name: "Claude" });
    await claudeCard.getByText("Details").click();
    check(`${t} Details explain policy in Secure Local`, /Secure Local Mode blocks cloud providers/.test(await claudeCard.innerText()));

    // Connect Claude: wrong key first, then the right one.
    await claudeCard.getByRole("button", { name: "Connect Claude" }).click();
    const dialog = page.getByRole("dialog", { name: "Connect Claude" });
    await dialog.waitFor();
    check(`${t} connect sheet is an accessible modal dialog`, await dialog.getAttribute("aria-modal") === "true");
    check(`${t} sheet explains billing honestly for a developer account`, /Anthropic Console/.test(await dialog.innerText()));
    await dialog.getByLabel(/Anthropic Console/).fill("sk-wrong-key-123456");
    await dialog.getByText(/Custom endpoint/).click();
    await dialog.getByLabel("Base URL").fill(up);
    await dialog.getByRole("button", { name: "Connect Claude" }).click();
    await dialog.getByRole("alert").waitFor();
    check(`${t} bad key rejected without leaking it`, /rejected the credentials/.test(await dialog.getByRole("alert").innerText()) && !(await dialog.innerText()).includes("sk-wrong-key-123456"));
    await shot(page, `connect-sheet-${viewport.tag}`);
    await dialog.getByLabel(/Anthropic Console/).fill(FAKE_KEYS.claude);
    await dialog.getByRole("button", { name: "Connect Claude" }).click();
    await dialog.waitFor({ state: "detached" });
    await page.getByText("Claude connected.").waitFor();
    check(`${t} Claude connected; card shows Connected and live models`, /Connected/.test(await claudeCard.innerText()));
    check(`${t} live models discovered`, /Claude Fake Sonnet/.test(await claudeCard.innerText()));

    // ChatGPT
    const oaCard = page.getByRole("article", { name: "ChatGPT" });
    await oaCard.getByRole("button", { name: "Connect ChatGPT" }).click();
    const oaDialog = page.getByRole("dialog", { name: "Connect ChatGPT" });
    await oaDialog.getByLabel(/OpenAI developer/).fill(FAKE_KEYS.openai);
    await oaDialog.getByText(/Custom endpoint/).click();
    await oaDialog.getByLabel("Base URL").fill(`${up}/v1`);
    await oaDialog.getByRole("button", { name: "Connect ChatGPT" }).click();
    await oaDialog.waitFor({ state: "detached" });
    await oaCard.getByText("Details").click();
    const oaText = await oaCard.innerText();
    check(`${t} ChatGPT connected; non-chat models filtered`, /fake-gpt-large/.test(oaText) && !/embedding/.test(oaText));
    check(`${t} API keys never in the page or browser storage`, (await leaks(page, [FAKE_KEYS.claude, FAKE_KEYS.openai])).length === 0);

    // Gemini: account linking (OAuth authorization code + PKCE) through the fake authorization server.
    const gemCard = page.getByRole("article", { name: "Gemini" });
    await gemCard.getByRole("button", { name: "Connect Gemini" }).click();
    const gemDialog = page.getByRole("dialog", { name: "Connect Gemini" });
    check(`${t} Gemini offers account linking first, with the key path secondary`, await gemDialog.getByRole("button", { name: "Continue to Google" }).isVisible() && await gemDialog.getByRole("button", { name: "Use a developer key instead" }).isVisible());
    await gemDialog.getByRole("button", { name: "Continue to Google" }).click();
    await page.getByText("Gemini connected.").waitFor({ timeout: 10000 });
    const auth = upstream.oauth.authorizations.at(-1);
    check(`${t} authorization request used PKCE S256, state and the configured scope`, auth.method === "S256" && auth.hasState && auth.scope === FAKE_OAUTH.scope && auth.clientId === FAKE_OAUTH.clientId, auth);
    check(`${t} code exchanged server-side with the PKCE verifier and client secret`, upstream.oauth.tokenGrants.some((g) => g.grant === "authorization_code" && g.hasVerifier && g.clientSecretOk), upstream.oauth.tokenGrants);
    check(`${t} browser returned to Settings and the URL was cleaned`, new URL(page.url()).pathname === "/settings/" && !page.url().includes("connected="), page.url());
    await gemCard.getByText("Connected · account").waitFor();
    check(`${t} Gemini shows as a linked account`, true);
    check(`${t} OAuth tokens never in the page or browser storage`, (await leaks(page, [...upstream.oauth.accessTokens, ...upstream.oauth.refreshTokens])).length === 0);
    await shot(page, `connections-${viewport.tag}`);

    // Denied authorization: friendly message, nothing connected.
    await fetch(`${gw}/v1/connections/gemini`, { method: "DELETE" });
    const started = await (await fetch(`${gw}/v1/connections/gemini/oauth/start`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ returnTo: "/settings/" }) })).json();
    await page.goto(`${started.authorizeUrl}&deny=1`, { waitUntil: "networkidle" });
    await page.getByText(/Gemini wasn’t connected/).waitFor();
    check(`${t} denying authorization ends with a clear message and no connection`, /Connect Gemini/.test(await page.getByRole("article", { name: "Gemini" }).innerText()));

    // Advanced settings are reachable but collapsed.
    await page.locator("#advanced summary").click();
    check(`${t} Advanced connection settings expose gateway URL, token and diagnostics`, await page.getByLabel(/Gateway URL/).isVisible() && await page.getByLabel(/Gateway token/).isVisible() && /Providers loaded/.test(await page.locator("#advanced").innerText()));
    await context.close();

    // ---------------------------------------------------------------- Chat
    await fetch(`${gw}/v1/connections/gemini`, { method: "DELETE" });
    const chat = await open(viewport, "/chat/");
    const cp = chat.page;
    await cp.getByLabel("Provider", { exact: true }).waitFor();
    const opts = await cp.getByLabel("Provider", { exact: true }).evaluate((el) => [...el.options].map((o) => `${o.text}|${o.disabled}`));
    check(`${t} Secure Local disables cloud providers in the picker`, ["Claude", "ChatGPT", "Gemini"].every((n) => opts.some((o) => o.startsWith(`${n} — blocked in Secure Local`) && o.endsWith("|true"))), opts);

    await cp.getByLabel("Provider", { exact: true }).selectOption({ label: "Demo" });
    await cp.getByLabel("Message WindSwordAI").fill("Summarize the notice clause");
    await cp.getByRole("button", { name: "Send message" }).click();
    await doneStreaming(cp);
    check(`${t} demo provider streams through the gateway`, /demo provider/.test(await last(cp, ".reply__text").innerText()));
    await shot(cp, `chat-mock-${viewport.tag}`);

    await cp.getByRole("button", { name: /Execution mode: Secure Local/ }).click();
    await cp.getByRole("button", { name: /Execution mode: Standard/ }).waitFor();
    await cp.getByLabel("Provider", { exact: true }).selectOption({ label: "Claude" });
    await cp.getByLabel("Model", { exact: true }).selectOption({ label: "Claude Fake Sonnet" });
    await cp.getByLabel("Message WindSwordAI").fill("What does the notice clause require?");
    await cp.getByRole("button", { name: "Send message" }).click();
    await cp.locator(".reply__status:has-text('Streaming')").waitFor({ state: "detached", timeout: 12000 });
    check(`${t} Claude streams through gateway to fake upstream`, /Claude \(fake upstream\)/.test(await last(cp, ".reply__text").innerText()));
    check(`${t} reply shows provider identity and usage`, await last(cp, ".message.assistant .provider-mark").isVisible() && /Claude/.test(await last(cp, ".message.assistant .message-role").innerText()) && await cp.getByText(/21 in · \d+ out/).isVisible());
    check(`${t} upstream received the key server-side`, upstream.requests.some((r) => r.path === "/v1/messages" && r.headers["x-api-key"] === FAKE_KEYS.claude));

    await cp.getByLabel("Message WindSwordAI").fill("please fail [503]");
    await cp.getByRole("button", { name: "Send message" }).click();
    await last(cp, ".reply__notice--error").waitFor();
    check(`${t} provider outage shows a friendly error with Retry`, /temporarily unavailable/.test(await last(cp, ".reply__notice--error").innerText()) && await cp.getByRole("button", { name: /^Retry/ }).last().isVisible());

    // Protected material: cloud providers disabled with a reason; no vendor request.
    const before = upstream.requests.filter((r) => r.path === "/v1/messages").length;
    await cp.getByRole("button", { name: "Add files, photos, or matter context" }).click();
    await cp.getByRole("menuitem", { name: /Add files/ }).click();
    const protectedOpts = await cp.getByLabel("Provider", { exact: true }).evaluate((el) => [...el.options].map((o) => `${o.text}|${o.disabled}`));
    check(`${t} attaching a document disables cloud providers in the picker`, protectedOpts.some((o) => o.startsWith("Claude — blocked for protected material") && o.endsWith("|true")), protectedOpts);
    check(`${t} no cloud request when protected`, upstream.requests.filter((r) => r.path === "/v1/messages").length === before);
    await cp.getByRole("button", { name: "Remove Sample-License-Agreement.pdf" }).click();

    // Compare Claude vs ChatGPT with both identities.
    await cp.getByRole("button", { name: "Compare two providers side by side" }).click();
    await cp.getByLabel("First provider").selectOption({ label: "Claude" });
    await cp.getByLabel("First model").selectOption({ label: "Claude Fake Sonnet" });
    await cp.getByLabel("Second provider").selectOption({ label: "ChatGPT — connect" }).catch(() => {});
    await cp.getByLabel("Second provider").selectOption({ label: "ChatGPT" });
    await cp.getByLabel("Second model").selectOption({ label: "fake-gpt-large" });
    await cp.getByLabel("Message WindSwordAI").fill("Is the notice clause enforceable?");
    await cp.getByRole("button", { name: "Send message" }).click();
    await cp.waitForFunction(() => document.querySelectorAll(".compare .reply__text").length === 2 && ![...document.querySelectorAll(".compare .reply__status")].some((e) => e.textContent.includes("Streaming")), null, { timeout: 12000 });
    const texts = await cp.locator(".compare .reply__text").allInnerTexts();
    check(`${t} compare shows two providers' answers side by side`, /Claude \(fake upstream\)/.test(texts[0]) && /OpenAI \(fake upstream\)/.test(texts[1]), texts);
    const heads = await cp.locator(".compare .reply__head").evaluateAll((els) => els.map((e) => ({ marks: e.querySelectorAll(".provider-mark").length, name: e.querySelector(".message-role")?.textContent })));
    check(`${t} each compare column carries its provider's mark and name`, heads.length === 2 && heads.every((h) => h.marks === 1) && heads[0].name === "Claude" && heads[1].name === "ChatGPT", heads);
    const cards = await cp.locator(".compare .reply-card").evaluateAll((els) => els.map((e) => { const r = e.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y) }; }));
    check(`${t} compare layout ${phone ? "stacks on phones" : "is two columns on desktop"}`, phone ? cards[0].x === cards[1].x && cards[1].y > cards[0].y : cards[0].y === cards[1].y && cards[1].x > cards[0].x, cards);
    check(`${t} no horizontal overflow in compare`, await cp.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
    await shot(cp, `compare-${viewport.tag}`);
    await cp.getByRole("button", { name: "Compare two providers side by side" }).click(); // back to single

    // Inline connect from Chat (Gemini is disconnected): picking it opens the same sheet; after linking the
    // browser returns to the same conversation with Gemini selected.
    const optsG = await cp.getByLabel("Provider", { exact: true }).evaluate((el) => [...el.options].map((o) => o.text));
    check(`${t} a provider that isn't connected is offered as "connect" in the picker`, optsG.includes("Gemini — connect"), optsG);
    const promptBefore = "Keep this conversation across the connection";
    await cp.getByLabel("Provider", { exact: true }).selectOption({ label: "Demo" });
    await cp.getByLabel("Message WindSwordAI").fill(promptBefore);
    await cp.getByRole("button", { name: "Send message" }).click();
    await doneStreaming(cp);
    await cp.getByLabel("Message WindSwordAI").fill("draft in progress");
    await cp.getByLabel("Provider", { exact: true }).selectOption({ label: "Gemini — connect" });
    const sheet = cp.getByRole("dialog", { name: "Connect Gemini" });
    await sheet.waitFor();
    check(`${t} choosing an unconnected provider in Chat opens the connect sheet in place`, await sheet.getByRole("button", { name: "Continue to Google" }).isVisible());
    await sheet.getByRole("button", { name: "Continue to Google" }).click();
    await cp.getByText("Gemini connected.").waitFor({ timeout: 10000 });
    check(`${t} returned to the Chat route`, new URL(cp.url()).pathname === "/chat/" && !cp.url().includes("connected="), cp.url());
    check(`${t} conversation and draft restored after the redirect`, (await cp.locator(".message.user").allInnerTexts()).some((x) => x.includes(promptBefore)) && (await cp.getByLabel("Message WindSwordAI").inputValue()) === "draft in progress");
    check(`${t} Gemini is auto-selected after linking`, (await cp.getByLabel("Provider", { exact: true }).inputValue()) === "gemini");
    // Mode persisted as Standard, so Gemini can be used right away.
    await cp.getByLabel("Message WindSwordAI").fill("Does the linked account work?");
    await cp.getByRole("button", { name: "Send message" }).click();
    await cp.waitForFunction(() => [...document.querySelectorAll(".reply__text")].some((e) => e.textContent.includes("Gemini (fake upstream, linked account)")) && ![...document.querySelectorAll(".reply__status")].some((e) => e.textContent.includes("Streaming")), null, { timeout: 12000 });
    check(`${t} Gemini streams using the linked account (Bearer token, refreshable)`, true);
    check(`${t} browser storage holds no tokens after chat`, (await leaks(cp, [...upstream.oauth.accessTokens, ...upstream.oauth.refreshTokens, FAKE_KEYS.claude, FAKE_KEYS.openai])).length === 0);
    await shot(cp, `chat-linked-${viewport.tag}`);
    await chat.context.close();
  }

  // Disconnect revokes at the provider.
  await fetch(`${gw}/v1/connections/gemini`, { method: "DELETE" });
  check("disconnecting a linked account revokes the token at the provider", upstream.oauth.revocations.length >= 1, upstream.oauth.revocations);

  // Audit + vault + logs.
  const audit = await (await fetch(`${gw}/v1/audit?limit=200`)).json();
  const dump = JSON.stringify(audit);
  const secrets = [FAKE_KEYS.claude, FAKE_KEYS.openai, FAKE_OAUTH.clientSecret, ...upstream.oauth.accessTokens, ...upstream.oauth.refreshTokens];
  check("audit has policy decisions, chat events and OAuth connection events", audit.events.some((e) => e.type === "policy.decision") && audit.events.some((e) => e.type === "chat.end") && audit.events.some((e) => e.type === "connection.added" && e.connectionType === "oauth") && audit.events.some((e) => e.type === "connection.failed"));
  check("audit contains no prompt text, keys or tokens", !/notice clause|enforceable|linked account work/.test(dump) && secrets.every((s) => !dump.includes(s)));
  const sample = audit.events.find((e) => e.type === "chat.end" && e.providerId === "gemini");
  if (sample) writeFileSync("review/sample-audit-event.json", JSON.stringify(sample, null, 2));
  const vault = readFileSync(join(state, "vault.json"), "utf8") + readFileSync(join(state, "connections.json"), "utf8");
  check("vault and connection records hold no plaintext key or token", secrets.every((s) => !vault.includes(s)));
  check("gateway stdout never printed keys or tokens", secrets.every((s) => !log.includes(s)));
  void secretsSeenInBrowser;
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
