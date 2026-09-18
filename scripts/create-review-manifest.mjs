import { mkdirSync, writeFileSync } from "node:fs";

mkdirSync("review", { recursive: true });
const manifest = {
  project: "WindSwordAI",
  generatedAt: new Date().toISOString(),
  demoMode: true,
  containsRealLegalData: false,
  reviewContract: {
    buildOutput: "out/",
    screenshots: "Added for UI-facing PRs beginning with PR 02",
    tests: ["lint", "typecheck", "test", "security:fixtures", "build"],
  },
  routes: ["/", "/chat", "/matters", "/night-studio", "/settings", "/status"],
};
writeFileSync("review/review-manifest.json", JSON.stringify(manifest, null, 2));
writeFileSync("review/summary.md", [
  "# WindSwordAI Review Artifact",
  "",
  "Synthetic demo content only. No legal documents, credentials, prompts, or matter data are included.",
  "",
  "Open `out/index.html` from a static server to review the exported build.",
  "",
].join("\n"));
console.log("Review manifest created.");
