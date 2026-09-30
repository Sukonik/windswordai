// End-to-end sign-in test: real UI + real gateway in WINDSWORD_AUTH=required mode + a fake Google
// (OpenID Connect, real RS256 ID tokens, PKCE-verifying token endpoint). Uses only FAKE credentials.
// Needs `npm run build` first.
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { launch } from "./lib-browser.mjs";
import { FAKE_GOOGLE, FAKE_KEYS, startFakeProviders } from "./fake-providers.mjs";

const GW_PORT = 8792;
const gw = `http://127.0.0.1:${GW_PORT}`;
const results = [];
const check = (name, ok, detail) => { results.push({ name, ok: Boolean(ok), detail }); console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok || !detail ? "" : `  -> ${JSON.stringify(detail)}`}`); };

const upstream = await startFakeProviders(0);
const up = `http://127.0.0.1:${upstream.port}`;
const state = mkdtempSync(join(tmpdir(), "ws-auth-e2e-"));
const child = spawn("node", ["gateway/server.ts"], {
  env: {
    ...process.env, WINDSWORD_PORT: String(GW_PORT), WINDSWORD_STATE_DIR: state, WINDSWORD_STATIC_DIR: "out",
    WINDSWORD_AUTH: "required", WINDSWORD_GOOGLE_CLIENT_ID: FAKE_GOOGLE.clientId, WINDSWORD_GOOGLE_CLIENT_SECRET: FAKE_GOOGLE.clientSecret,
    WINDSWORD_GOOGLE_AUTHORIZE_URL: `${up}/google/authorize`, WINDSWORD_GOOGLE_TOKEN_URL: `${up}/google/token`, WINDSWORD_GOOGLE_JWKS_URL: `${up}/google/certs`,
    // Environment API keys must be ignored in multi-user mode; provide one to prove it.
    ANTHROPIC_API_KEY: FAKE_KEYS.claude, ANTHROPIC_BASE_URL: up,
  },
  stdio: ["ignore", "pipe", "pipe"],
});
let log = "";
child.stdout.on("data", (d) => (log += d));
child.stderr.on("data", (d) => (log += d));
for (let i = 0; i < 60; i++) { try { if ((await fetch(`${gw}/v1/health`)).ok) break; } catch { /* starting */ } await new Promise((r) => setTimeout(r, 100)); }

mkdirSync("review/screenshots", { recursive: true });
const browser = await launch();
const errors = [];
const setIdentity = (identity) => fetch(`${up}/google/_next`, { method: "POST", body: JSON.stringify(identity) });
let ALICE, BOB; // fresh identities per viewport so each pass starts with nothing connected
const identities = (tag) => { ALICE = { sub: `sub-alice-${tag}`, email: `alice${tag}@example.com`, name: "Alice Example" }; BOB = { sub: `sub-bob-${tag}`, email: `bob${tag}@example.com`, name: "Bob Example" }; };

async function open(viewport, path, context) {
  const ctx = context ?? await browser.newContext({ viewport });
  if (!context) await ctx.addInitScript((url) => { try { if (!localStorage.getItem("windsword-gateway")) localStorage.setItem("windsword-gateway", JSON.stringify({ url })); localStorage.setItem("windsword-theme", "dark"); } catch { /* ignore */ } }, gw);
  const page = await ctx.newPage();
  page.on("console", (m) => m.type() === "error" && errors.push(`console: ${m.text()}`));
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  page.on("response", (r) => { if (r.status() >= 500) errors.push(`HTTP ${r.status()} ${r.request().method()} ${r.url()}`); });
  await page.goto(gw + path, { waitUntil: "networkidle" });
  return { context: ctx, page };
}
const shot = (page, name) => page.screenshot({ path: `review/screenshots/auth-${name}.png` });
const openMenu = async (page, viewport) => { if (viewport.width < 900) await page.getByRole("button", { name: "Open navigation menu" }).click(); };

try {
  for (const viewport of [{ width: 390, height: 844, tag: "390" }, { width: 1440, height: 1000, tag: "1440" }]) {
    const t = `[${viewport.tag}]`;
    const phone = viewport.width < 900;
    identities(viewport.tag);

    // ------------------------------------------------ signed out: the app is gated
    await setIdentity(ALICE);
    const { context, page } = await open(viewport, "/chat/");
    await page.getByRole("heading", { name: "Sign in to WindSwordAI" }).waitFor();
    check(`${t} signed-out visitors see the sign-in screen instead of the app`, !(await page.getByLabel("Message WindSwordAI").count()));
    check(`${t} sign-in copy says identity only (no Drive/Gemini access)`, /does not get access to your Google Drive or to Gemini/.test(await page.locator(".login-gate").innerText()));
    await shot(page, `login-${viewport.tag}`);
    const noApi = await page.evaluate(async () => (await fetch("/v1/providers?mode=secure_local", { credentials: "include" })).status);
    check(`${t} API is closed to signed-out callers`, noApi === 401);

    // ------------------------------------------------ sign in as Alice
    await page.getByRole("link", { name: "Continue with Google" }).click();
    await page.waitForURL(/\/chat\/$/);
    await page.getByLabel("Message WindSwordAI").waitFor();
    const login = upstream.google.logins.at(-1);
    check(`${t} Google was asked for exactly openid email profile, with PKCE S256 and a nonce`, login.scope === "openid email profile" && login.method === "S256" && login.hasNonce, login);
    check(`${t} code exchanged server-side with the verifier and client secret`, upstream.google.tokenGrants.at(-1)?.hasVerifier && upstream.google.tokenGrants.at(-1)?.secretOk);
    await openMenu(page, viewport);
    const account = page.locator(".account");
    check(`${t} account row shows the signed-in user`, /Alice Example/.test(await account.innerText()) && /alice\d+@example.com/.test(await account.innerText()));
    await shot(page, `signed-in-${viewport.tag}`);
    if (phone) await page.getByRole("button", { name: "Close navigation", exact: true }).click();

    const cookies = await context.cookies();
    const sess = cookies.find((c) => c.name === "windsword_session");
    check(`${t} session cookie is HttpOnly + SameSite=Lax`, sess?.httpOnly === true && sess?.sameSite === "Lax", sess && { httpOnly: sess.httpOnly, sameSite: sess.sameSite });
    check(`${t} session id is not readable by page JavaScript or stored in browser storage`, await page.evaluate((v) => !document.cookie.includes(v) && !JSON.stringify({ ...localStorage, ...sessionStorage }).includes(v), sess.value));
    check(`${t} no login-binding cookie left behind`, !cookies.some((c) => c.name === "ws_login"));

    // ------------------------------------------------ Alice connects Claude (own key) and chats
    await page.goto(`${gw}/settings/`, { waitUntil: "networkidle" });
    const claudeCard = page.getByRole("article", { name: "Claude" });
    check(`${t} environment API keys are NOT shared with signed-in users`, /Connect Claude/.test(await claudeCard.innerText()));
    await claudeCard.getByRole("button", { name: "Connect Claude" }).click();
    const dialog = page.getByRole("dialog", { name: "Connect Claude" });
    await dialog.getByLabel(/Anthropic Console/).fill(FAKE_KEYS.claude);
    await dialog.getByText(/Custom endpoint/).click();
    await dialog.getByLabel("Base URL").fill(up);
    await dialog.getByRole("button", { name: "Connect Claude" }).click();
    await dialog.waitFor({ state: "detached" });
    await page.getByText("Claude connected.").waitFor();
    check(`${t} state-changing calls work with the CSRF token (Alice connected Claude)`, /Connected/.test(await claudeCard.innerText()));
    await page.goto(`${gw}/chat/`, { waitUntil: "networkidle" });
    await page.getByRole("button", { name: /Execution mode: Secure Local/ }).click();
    await page.getByLabel("Provider", { exact: true }).selectOption({ label: "Claude" });
    await page.getByLabel("Model", { exact: true }).selectOption({ label: "Claude Fake Sonnet" });
    await page.getByLabel("Message WindSwordAI").fill("Hello from Alice");
    await page.getByRole("button", { name: "Send message" }).click();
    await page.waitForFunction(() => [...document.querySelectorAll(".reply__text")].some((e) => e.textContent.includes("Claude (fake upstream)")) && ![...document.querySelectorAll(".reply__status")].some((e) => e.textContent.includes("Streaming")), null, { timeout: 12000 });
    check(`${t} Alice's chat streams through her own connection`, true);

    // ------------------------------------------------ CSRF: a forged cross-site style request is refused
    const forged = await page.evaluate(async () => (await fetch("/v1/connections/claude", { method: "DELETE", credentials: "include" })).status);
    check(`${t} state-changing request without the CSRF token is refused`, forged === 403, forged);
    const evilOrigin = await page.evaluate(async () => (await fetch("/v1/connections/claude", { method: "DELETE", credentials: "include", headers: { "x-csrf-token": "wrong" } })).status);
    check(`${t} state-changing request with a wrong CSRF token is refused`, evilOrigin === 403, evilOrigin);

    // ------------------------------------------------ sign out
    await openMenu(page, viewport);
    await page.getByRole("button", { name: "Sign out" }).click();
    await page.getByRole("heading", { name: "Sign in to WindSwordAI" }).waitFor();
    check(`${t} sign out returns to the sign-in screen and clears the cookie`, !(await context.cookies()).some((c) => c.name === "windsword_session"));
    const stolen = sess.value;
    const replay = await fetch(`${gw}/v1/providers?mode=secure_local`, { headers: { cookie: `windsword_session=${stolen}` } });
    check(`${t} a copied session cookie is useless after sign out`, replay.status === 401);

    // ------------------------------------------------ sign in as Bob: sees none of Alice's data
    await setIdentity(BOB);
    await page.getByRole("link", { name: "Continue with Google" }).click();
    await page.waitForURL(/\/chat\/$/);
    await page.goto(`${gw}/settings/`, { waitUntil: "networkidle" });
    const bobClaude = page.getByRole("article", { name: "Claude" });
    check(`${t} a second user does not see the first user's connection`, /Connect Claude/.test(await bobClaude.innerText()) && !/Connected/.test(await bobClaude.locator(".badge").first().innerText()));
    const audit = await page.evaluate(async () => (await (await fetch("/v1/audit?limit=200", { credentials: "include" })).json()).events);
    const ids = new Set(audit.map((e) => e.userId));
    check(`${t} audit view is scoped to the signed-in user`, ids.size === 1 && [...ids][0]?.startsWith("usr_"), [...ids]);
    check(`${t} audit rows carry an opaque id, never an email or name`, !JSON.stringify(audit).includes("@") && !/Alice|Bob/.test(JSON.stringify(audit)));

    // ------------------------------------------------ expired session mid-use falls back to sign-in
    await context.clearCookies();
    await page.goto(`${gw}/chat/`, { waitUntil: "networkidle" });
    await page.getByRole("heading", { name: "Sign in to WindSwordAI" }).waitFor();
    check(`${t} an ended session shows the sign-in screen again`, true);

    // ------------------------------------------------ denied consent
    await setIdentity({ deny: true });
    await page.getByRole("link", { name: "Continue with Google" }).click();
    await page.getByText("Sign-in was cancelled.").waitFor();
    check(`${t} cancelling on Google returns to a friendly message and stays signed out`, !(await context.cookies()).some((c) => c.name === "windsword_session"));
    await context.close();
  }

  // ------------------------------------------------ server-side hygiene
  const sessions = readFileSync(join(state, "sessions.json"), "utf8");
  const users = readFileSync(join(state, "users.json"), "utf8");
  const auditFile = readFileSync(join(state, "audit.jsonl"), "utf8");
  check("only hashed session ids are stored on disk", !/windsword_session/.test(sessions) && Object.keys(JSON.parse(sessions)).every((k) => /^[0-9a-f]{64}$/.test(k)));
  check("user records hold identity only (no tokens)", !/ya29|id_token|access_token/.test(users) && /alice390@example.com/.test(users));
  const secrets = [FAKE_GOOGLE.clientSecret, "ya29.e2e-google-access", FAKE_KEYS.claude];
  check("audit log has login/logout events and no emails, secrets or tokens", /auth\.login/.test(auditFile) && /auth\.logout/.test(auditFile) && !/@example\.com/.test(auditFile) && secrets.every((s) => !auditFile.includes(s)));
  check("gateway output never printed the client secret or any token", secrets.every((s) => !log.includes(s)) && !/eyJ[A-Za-z0-9_-]{20,}/.test(log));
  check("gateway announced sign-in without revealing the secret", /sign-in\s*: Google REQUIRED/.test(log) && /secret set: yes/.test(log) && /openid email profile/.test(log));
  check("environment API keys were ignored in multi-user mode", /environment API keys are ignored while sign-in is required/.test(log));

  // ------------------------------------------------ setup page: paste the secret in the browser, no .env editing
  {
    const gw2Port = 8793, gw2 = `http://127.0.0.1:${gw2Port}`;
    const state2 = mkdtempSync(join(tmpdir(), "ws-setup-e2e-"));
    const env2 = { ...process.env, WINDSWORD_PORT: String(gw2Port), WINDSWORD_STATE_DIR: state2, WINDSWORD_STATIC_DIR: "out",
      WINDSWORD_GOOGLE_AUTHORIZE_URL: `${up}/google/authorize`, WINDSWORD_GOOGLE_TOKEN_URL: `${up}/google/token`, WINDSWORD_GOOGLE_JWKS_URL: `${up}/google/certs` };
    delete env2.WINDSWORD_AUTH; delete env2.WINDSWORD_GOOGLE_CLIENT_ID; delete env2.WINDSWORD_GOOGLE_CLIENT_SECRET;
    const c2 = spawn("node", ["gateway/server.ts"], { env: env2, stdio: ["ignore", "pipe", "pipe"] });
    let log2 = "";
    c2.stdout.on("data", (d) => (log2 += d)); c2.stderr.on("data", (d) => (log2 += d));
    try {
      for (let i = 0; i < 60; i++) { try { if ((await fetch(`${gw2}/v1/health`)).ok) break; } catch { /* starting */ } await new Promise((r) => setTimeout(r, 100)); }
      check("[connect] a fresh gateway starts in local mode and points at Connections", /sign-in\s*: off/.test(log2) && /settings\//.test(log2));
      const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
      await ctx.addInitScript((url) => { try { localStorage.setItem("windsword-gateway", JSON.stringify({ url })); localStorage.setItem("windsword-theme", "dark"); } catch { /* ignore */ } }, gw2);
      const page = await ctx.newPage();
      const pageErrors = [];
      page.on("pageerror", (e) => pageErrors.push(e.message));
      await page.goto(`${gw2}/settings/`, { waitUntil: "networkidle" });
      await page.getByRole("heading", { name: "Connections", exact: true }).waitFor();
      const card = page.getByRole("article", { name: "Google Sign-In" });
      check("[connect] Connections lists categories and a Google Sign-In card marked Needs setup", /identity/i.test(await page.locator(".connections").innerText()) && /Needs setup/.test(await card.innerText()) && (await page.getByText("Coming soon").count()) >= 3);
      await page.screenshot({ path: "review/screenshots/auth-connections-390.png", fullPage: true });
      await card.getByRole("button", { name: "Connect" }).click();
      const sheet = page.getByRole("dialog", { name: "Google Sign-In" });
      await sheet.waitFor();
      await page.waitForTimeout(500); // let the slide-up finish
      const box = await sheet.boundingBox();
      check("[connect] on a phone the form opens as a bottom sheet", box && Math.abs(box.y + box.height - 844) < 2 && box.width >= 388, box);
      check("[connect] the secret field is masked and empty", (await sheet.getByLabel("Client Secret").getAttribute("type")) === "password" && (await sheet.getByLabel("Client Secret").inputValue()) === "");
      check("[connect] normal view avoids technical terms", !/redirect URI|PKCE|bearer|vault/i.test(await sheet.innerText()));
      await sheet.getByLabel("Client ID").fill(FAKE_GOOGLE.clientId);
      await sheet.getByLabel("Client Secret").fill(FAKE_GOOGLE.clientSecret);
      await page.screenshot({ path: "review/screenshots/auth-connections-sheet-390.png" });
      await sheet.getByRole("button", { name: "Save", exact: true }).click();
      await sheet.getByText("Saved ✓", { exact: true }).waitFor();
      const html = await page.content();
      check("[connect] after saving, the secret is gone from the page and shows 'Secret saved ✓' with Replace secret", !html.includes(FAKE_GOOGLE.clientSecret) && (await sheet.getByText("Secret saved ✓").count()) === 1 && (await sheet.getByRole("button", { name: "Replace secret" }).count()) === 1 && (await sheet.getByLabel("Client Secret").count()) === 0);
      check("[connect] the secret is not in the URL, cookies or browser storage", !page.url().includes(FAKE_GOOGLE.clientSecret) && (await page.evaluate((v) => !JSON.stringify({ ...localStorage, ...sessionStorage }).includes(v) && !document.cookie.includes(v), FAKE_GOOGLE.clientSecret)));
      await sheet.getByRole("button", { name: "Test Connection" }).click();
      await sheet.getByText("Google accepted the Client ID and Secret.").waitFor();
      check("[connect] Test Connection reports success in plain words", true);
      await sheet.getByRole("button", { name: "Replace secret" }).click();
      check("[connect] Replace secret is explicit and shows an empty masked field", (await sheet.getByLabel("Client Secret").inputValue()) === "");
      await sheet.getByText("Advanced").click();
      check("[connect] technical addresses live under Advanced", /oauth\/callback\/google/.test(await sheet.innerText()));
      check("[connect] Remove connection is separate and destructive-styled", (await sheet.locator(".connections__danger .btn--danger").count()) === 1);
      await sheet.getByRole("button", { name: "Close" }).click();
      await sheet.waitFor({ state: "detached" });
      check("[connect] the card now reads Connected ✓ with Manage", /Connected ✓/.test(await card.innerText()) && (await card.getByRole("button", { name: "Manage" }).count()) === 1);
      const files = ["vault.json", "connect.json", "audit.jsonl"].map((f) => readFileSync(join(state2, f), "utf8")).join("\n");
      check("[connect] the secret is stored encrypted, not in plain text on disk", !files.includes(FAKE_GOOGLE.clientSecret) && /secretRefs/.test(files));
      // Sign-in is now on, without a restart, and the fake Google accepts the pasted secret at the token step.
      await setIdentity({ sub: "sub-setup", email: "setup@example.com", name: "Setup User" });
      await ctx.addInitScript((url) => { try { localStorage.setItem("windsword-gateway", JSON.stringify({ url })); } catch { /* ignore */ } }, gw2);
      await page.goto(`${gw2}/chat/`, { waitUntil: "networkidle" });
      await page.getByRole("heading", { name: "Sign in to WindSwordAI" }).waitFor();
      await page.getByRole("link", { name: "Continue with Google" }).click();
      await page.waitForURL(/\/chat\/$/);
      await page.getByLabel("Message WindSwordAI").waitFor();
      check("[connect] Google sign-in works with the pasted secret (no .env edited, no restart)", upstream.google.tokenGrants.at(-1)?.secretOk === true);
      check("[connect] gateway output never contained the pasted secret", !log2.includes(FAKE_GOOGLE.clientSecret));
      // Persisted: a restart keeps sign-in required and configured.
      c2.kill(); await new Promise((r) => c2.once("exit", r));
      log2 = "";
      const c3 = spawn("node", ["gateway/server.ts"], { env: env2, stdio: ["ignore", "pipe", "pipe"] });
      c3.stdout.on("data", (d) => (log2 += d)); c3.stderr.on("data", (d) => (log2 += d));
      for (let i = 0; i < 60; i++) { try { if ((await fetch(`${gw2}/v1/health`)).ok) break; } catch { /* starting */ } await new Promise((r) => setTimeout(r, 100)); }
      check("[connect] after a restart the saved setup is still in effect", /sign-in\s*: Google REQUIRED/.test(log2) && /secret set: yes/.test(log2) && !log2.includes(FAKE_GOOGLE.clientSecret));
      c3.kill();
      check("[connect] no page errors", pageErrors.length === 0, pageErrors);
      await ctx.close();
    } finally { c2.kill(); }
  }
  const unexpected = errors.filter((e) => !/status of (401|403)/.test(e));
  check("no unexpected console or page errors", unexpected.length === 0, errors);
} catch (err) {
  check("auth e2e run completed", false, String(err?.stack || err));
} finally {
  await browser.close();
  child.kill();
  upstream.server.close();
}

mkdirSync("review", { recursive: true });
writeFileSync("review/auth-e2e.json", JSON.stringify(results, null, 2));
const failed = results.filter((r) => !r.ok);
console.log(`\nAuth E2E: ${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
