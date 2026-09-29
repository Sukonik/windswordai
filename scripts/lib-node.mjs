// Node version helpers for launching the TypeScript gateway.
// Node runs .ts files natively (type stripping) unflagged from 22.18 / 23.6.
// Node 22.6 - 22.17 can do it with --experimental-strip-types. Older cannot.

export function parseVersion(v) {
  const [major = 0, minor = 0, patch = 0] = String(v).replace(/^v/, "").split(".").map((n) => Number.parseInt(n, 10) || 0);
  return { major, minor, patch };
}

/** @returns {{ ok: boolean, flag: string[], message?: string }} */
export function tsSupport(version) {
  const { major, minor } = parseVersion(version);
  if (major > 23 || (major === 23 && minor >= 6) || (major === 22 && minor >= 18)) return { ok: true, flag: [] };
  if ((major === 22 && minor >= 6) || major === 23) return { ok: true, flag: ["--experimental-strip-types"] };
  return {
    ok: false,
    flag: [],
    message: `WindSwordAI needs Node 22 or newer (found ${version}). Install the current LTS from https://nodejs.org and try again.`,
  };
}
