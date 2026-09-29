// Cross-platform "local" build: the UI the gateway serves itself (same-origin gateway detection on).
// Replaces `VAR=value next build`, which does not work in Windows PowerShell / cmd.
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const nextBin = require.resolve("next/dist/bin/next");

const result = spawnSync(process.execPath, [nextBin, "build"], {
  stdio: "inherit",
  env: { ...process.env, NEXT_PUBLIC_DEMO_MODE: "false", NEXT_PUBLIC_GATEWAY_SAME_ORIGIN: "true" },
});
process.exit(result.status ?? 1);
