import { mkdirSync, writeFileSync } from "node:fs";

mkdirSync("review", { recursive: true });
const manifest = {
  project: "WindSwordAI",
  generatedAt: new Date().toISOString(),
  demoMode: true,
  containsRealLegalData: false,
  reviewContract: {
    buildOutput: "out/",
    screenshots: [
      "review/screenshots/desktop-dark.png",
      "review/screenshots/mobile-dark-390.png",
      "review/screenshots/desktop-light.png"
    ],
    tests: ["lint", "typecheck", "test", "security:fixtures", "build"],
  },
  visualIdentity: {
    palette: ["steel/chrome", "neon bright blue", "white", "dark graphite", "wake red"],
    keyInteraction: "Chat composer with + add-on hub, voice, High effort selector, and send control",
    themes: ["dark", "light"]
  },
  routes: ["/", "/chat", "/matters", "/night-studio", "/settings", "/status"],
};
writeFileSync("review/review-manifest.json", JSON.stringify(manifest, null, 2));
writeFileSync("review/summary.md", [
  "# WindSwordAI Review Artifact",
  "",
  "Synthetic demo content only. No legal documents, credentials, prompts, or matter data are included.",
  "",
  "## Visual review",
  "",
  "- `review/screenshots/desktop-dark.png`",
  "- `review/screenshots/mobile-dark-390.png`",
  "- `review/screenshots/desktop-light.png`",
  "",
  "The PR 02 chat interface is interactive but uses a mock local response only.",
  "",
].join("\n"));
console.log("Review manifest created.");
