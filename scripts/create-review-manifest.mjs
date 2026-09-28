import { mkdirSync, writeFileSync } from "node:fs";

mkdirSync("review", { recursive: true });
const manifest = {
  project: "WindSwordAI",
  generatedAt: new Date().toISOString(),
  demoMode: true,
  containsRealLegalData: false,
  liveDemo: "https://sukonik.github.io/windswordai/",
  reviewContract: {
    buildOutput: "out/",
    screenshots: [
      "review/screenshots/home-desktop-dark-1440.png",
      "review/screenshots/home-mobile-dark-390.png",
      "review/screenshots/mobile-menu-dark-390.png",
      "review/screenshots/mobile-menu-light-390.png",
      "review/screenshots/mobile-chat-light-390.png",
      "review/screenshots/desktop-dark-1440.png",
      "review/screenshots/laptop-dark-1024.png",
      "review/screenshots/tablet-dark-768.png",
      "review/screenshots/mobile-dark-430.png",
      "review/screenshots/mobile-dark-390.png",
      "review/screenshots/mobile-dark-360.png",
      "review/screenshots/mobile-dark-320.png",
      "review/screenshots/desktop-light-1440.png"
    ],
    responsiveAudit: "review/responsive-audit.json",
    testedWidths: [320, 360, 390, 430, 768, 1024, 1440],
    tests: ["lint", "typecheck", "test", "security:fixtures", "build", "review:responsive", "mobile-menu", "theme-persistence"],
  },
  visualIdentity: {
    palette: ["steel/chrome", "neon bright blue", "white", "dark graphite", "wake red"],
    keyInteraction: "Chat composer with + add-on hub, voice, High effort selector, and send control",
    themes: ["dark", "light"],
    performancePrinciple: "Rich with CSS and responsive layout; no heavy animation runtime."
  },
  routes: ["/", "/chat", "/matters", "/night-studio", "/settings", "/status"],
};
writeFileSync("review/review-manifest.json", JSON.stringify(manifest, null, 2));
writeFileSync("review/summary.md", [
  "# WindSwordAI Review Artifact",
  "",
  "Synthetic demo content only. No legal documents, credentials, prompts, or matter data are included.",
  "",
  "## Live demo",
  "",
  "https://sukonik.github.io/windswordai/",
  "",
  "## Visual review",
  "",
  "- `review/screenshots/home-desktop-dark-1440.png`",
  "- `review/screenshots/home-mobile-dark-390.png`",
  "- `review/screenshots/mobile-menu-dark-390.png`",
  "- `review/screenshots/mobile-menu-light-390.png`",
  "- `review/screenshots/mobile-chat-light-390.png`",
  "- `review/screenshots/desktop-dark-1440.png`",
  "- `review/screenshots/laptop-dark-1024.png`",
  "- `review/screenshots/tablet-dark-768.png`",
  "- `review/screenshots/mobile-dark-430.png`",
  "- `review/screenshots/mobile-dark-390.png`",
  "- `review/screenshots/mobile-dark-360.png`",
  "- `review/screenshots/mobile-dark-320.png`",
  "- `review/screenshots/desktop-light-1440.png`",
  "",
  "## Responsive QA",
  "",
  "See `review/responsive-audit.json` for overflow, console-error, mobile navigation, theme switching, persistence, and drawer interaction checks.",
  "",
  "The current chat experience uses a mock local response only.",
  "",
].join("\n"));
console.log("Review manifest created.");