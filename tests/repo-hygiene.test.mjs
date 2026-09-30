import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";

const tracked = () => {
  try {
    return execFileSync("git", ["ls-files", "-z"], { encoding: "utf8" }).split("\0").filter(Boolean);
  } catch {
    return null; // not a git checkout (e.g. exported tarball): skip content scans
  }
};

test(".gitignore keeps local secrets and gateway state out of git", () => {
  const ignore = readFileSync(".gitignore", "utf8").split(/\r?\n/).map((l) => l.trim());
  assert.ok(ignore.includes(".env"), ".env must be ignored");
  assert.ok(ignore.includes(".env.*") && ignore.includes("!.env.example"), ".env.* ignored except .env.example");
  assert.ok(ignore.includes("/.windsword/"), "gateway state (vault, sessions, users) must be ignored");
  for (const pattern of ["*.pem", "*.key"]) assert.ok(ignore.includes(pattern), `${pattern} must be ignored`);
});

test(".env, .env.local and gateway state are not tracked", () => {
  const files = tracked();
  if (!files) return;
  for (const f of files) {
    assert.ok(!/^\.env(\..*)?$/.test(f) || f === ".env.example", `${f} must not be tracked`);
    assert.ok(!f.startsWith(".windsword/"), `${f} must not be tracked`);
  }
});

test(".env.example holds placeholders only and documents the Google variables", () => {
  const lines = readFileSync(".env.example", "utf8").split(/\r?\n/).filter((l) => l.trim() && !l.trim().startsWith("#"));
  const vars = Object.fromEntries(lines.map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]));
  assert.ok("WINDSWORD_GOOGLE_CLIENT_ID" in vars && "WINDSWORD_GOOGLE_CLIENT_SECRET" in vars, "Google placeholders present");
  for (const [name, value] of Object.entries(vars)) {
    if (/SECRET|TOKEN|KEY|PASSWORD/i.test(name)) assert.equal(value, "", `${name} must be empty in .env.example`);
  }
  assert.equal(vars.WINDSWORD_GOOGLE_CLIENT_ID, "", "the client id is not baked into the example either");
});

test("no real-looking credentials are committed anywhere", () => {
  const files = tracked();
  if (!files) return;
  const patterns = [
    [/GOCSPX-[A-Za-z0-9_-]{24,}/, "Google OAuth client secret"],
    [/AIza[0-9A-Za-z_-]{35}/, "Google API key"],
    [/sk-ant-[A-Za-z0-9_-]{20,}/, "Anthropic API key"],
    [/sb_secret_[A-Za-z0-9_-]{20,}/, "Supabase secret key"],
    [/SUPABASE_SERVICE_ROLE_KEY[ \t]*=[ \t]*(?!PASTE_|YOUR_|<)[A-Za-z0-9._-]{20,}/, "Supabase service key assignment"],
    [/sk-proj-[A-Za-z0-9_-]{20,}/, "OpenAI API key"],
    [/-----BEGIN (RSA |EC |OPENSSH |)PRIVATE KEY-----/, "private key block"],
    [/(?:WINDSWORD_GOOGLE_CLIENT_SECRET|GOOGLE_CLIENT_SECRET)[ \t]*=[ \t]*(?!PASTE_|YOUR_|your-|<)[^\s#'"`$<]{8,}/, "assigned Google client secret"],
  ];
  const skip = /\.(png|webp|ico|jpe?g|gif|woff2?|lock)$/i;
  const offenders = [];
  for (const f of files) {
    if (skip.test(f) || f === "package-lock.json") continue;
    let text;
    try {
      if (statSync(f).size > 2_000_000) continue;
      text = readFileSync(f, "utf8");
    } catch {
      continue;
    }
    for (const [re, label] of patterns) if (re.test(text)) offenders.push(`${f}: ${label}`);
  }
  assert.deepEqual(offenders, [], "possible secret committed");
});
