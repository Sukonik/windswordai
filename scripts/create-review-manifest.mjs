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
      "review/screenshots/chat-desktop-dark-1440.png",
      "review/screenshots/chat-laptop-dark-1024.png",
      "review/screenshots/chat-tablet-dark-768.png",
      "review/screenshots/chat-mobile-dark-430.png",
      "review/screenshots/chat-mobile-dark-390.png",
      "review/screenshots/chat-mobile-light-390.png",
      "review/screenshots/mobile-menu-dark-390.png",
      "review/screenshots/mobile-menu-light-390.png"
    ],
    responsiveAudit: "review/responsive-audit.json",
    testedProfiles: [
      "phone-320",
      "phone-360",
      "phone-390",
      "phone-430",
      "tablet-768",
      "laptop-1024",
      "desktop-1440"
    ],
    tests: [
      "lint",
      "typecheck",
      "test",
      "security:fixtures",
      "build",
      "review:responsive"
    ],
  },
  mobileFirst: {
    themeToggleOnPhone: true,
    themePersistenceTested: true,
    fullScreenPhoneMenu: true,
    touchTargetsChecked: true,
    routeCloseBehaviorChecked: true,
    plusMenuViewportChecked: true
  },
  visualIdentity: {
    palette: ["steel/chrome", "neon bright blue", "white", "dark graphite", "wake red"],
    mark: "Original winged WindSwordAI longsword",
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
  "## Mobile-first visual review",
  "",
  "- `review/screenshots/home-mobile-dark-390.png`",
  "- `review/screenshots/chat-mobile-dark-390.png`",
  "- `review/screenshots/chat-mobile-light-390.png`",
  "- `review/screenshots/mobile-menu-dark-390.png`",
  "- `review/screenshots/mobile-menu-light-390.png`",
  "- `review/screenshots/chat-mobile-dark-430.png`",
  "- `review/screenshots/chat-tablet-dark-768.png`",
  "",
  "## Desktop review",
  "",
  "- `review/screenshots/home-desktop-dark-1440.png`",
  "- `review/screenshots/chat-laptop-dark-1024.png`",
  "- `review/screenshots/chat-desktop-dark-1440.png`",
  "",
  "## Interaction QA",
  "",
  "See `review/responsive-audit.json` for overflow, console, touch-target, mobile-menu, theme-persistence, route-close, and + menu checks.",
  "",
].join("\n"));

console.log("Review manifest created.");
