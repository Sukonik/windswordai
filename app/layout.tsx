import type { Metadata } from "next";
import { AppShell } from "@/components/AppShell";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "WindSwordAI",
    template: "%s · WindSwordAI",
  },
  description: "Secure, local-first AI workspace for legal teams.",
  applicationName: "WindSwordAI",
};

const themeBoot = `
(() => {
  try {
    const saved = localStorage.getItem("windsword-theme");
    document.documentElement.dataset.theme = saved === "light" ? "light" : "dark";
  } catch {
    document.documentElement.dataset.theme = "dark";
  }
})();
`;

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeBoot }} />
      </head>
      <body>
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
