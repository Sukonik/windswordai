// Cross-platform launcher for the gateway: checks the Node version, then runs gateway/server.ts.
// Usage: node scripts/run-gateway.mjs
import { spawn } from "node:child_process";
import { tsSupport } from "./lib-node.mjs";

const support = tsSupport(process.version);
if (!support.ok) {
  console.error(support.message);
  process.exit(1);
}

const child = spawn(process.execPath, [...support.flag, "--disable-warning=ExperimentalWarning", "gateway/server.ts"], { stdio: "inherit", env: process.env });
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => child.kill(signal));
child.on("exit", (code) => process.exit(code ?? 0));
