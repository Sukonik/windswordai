import type { Metadata, Viewport } from "next";
import { asset } from "@/lib/assets";
import { AppShell } from "@/components/AppShell";
import { GatewayProvider } from "@/components/GatewayProvider";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "WindSwordAI",
    template: "%s · WindSwordAI",
  },
  description: "Secure, local-first AI workspace for legal teams.",
  applicationName: "WindSwordAI",
  manifest: asset("/manifest.webmanifest"),
  icons: {
    icon: [
      { url: asset("/favicon.ico"), sizes: "48x48" },
      { url: asset("/favicon-16.png"), type: "image/png", sizes: "16x16" },
      { url: asset("/favicon-32.png"), type: "image/png", sizes: "32x32" },
      { url: asset("/icons/icon-192.png"), type: "image/png", sizes: "192x192" },
    ],
    apple: [{ url: asset("/icons/apple-touch-icon.png"), sizes: "180x180" }],
  },
  appleWebApp: { capable: true, title: "WindSword", statusBarStyle: "black-translucent" },
  openGraph: {
    title: "WindSwordAI",
    description: "Secure, local-first AI workspace for legal teams.",
    images: [{ url: asset("/brand/og-card.png"), width: 1200, height: 630 }],
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  interactiveWidget: "resizes-content",
  themeColor: "#0b0e13",
};

const themeBoot = `
(() => {
  try {
    const saved = localStorage.getItem("windsword-theme");
    const light = saved === "light";
    document.documentElement.dataset.theme = light ? "light" : "dark";
    if (light) document.querySelector('meta[name="theme-color"]')?.setAttribute("content", "#edf3f7");
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
        <GatewayProvider>
          <AppShell>{children}</AppShell>
        </GatewayProvider>
      </body>
    </html>
  );
}
