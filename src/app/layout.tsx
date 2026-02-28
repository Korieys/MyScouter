import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "MyScouter — Autonomous Product Scout",
  description: "Paste any URL. Get launch-ready screenshots, device mockups, social assets, and marketing copy — all in one click.",
  keywords: ["product scout", "screenshot tool", "mockup generator", "launch assets", "marketing automation"],
  openGraph: {
    title: "MyScouter — Send a Scout. Bring back assets.",
    description: "Autonomous product scouting: screenshots, device mockups, social-sized images, and marketing copy from any URL.",
    siteName: "MyScouter",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "MyScouter — Autonomous Product Scout",
    description: "Paste a URL → Get launch-ready marketing assets in one click.",
  },
  icons: {
    icon: "/favicon.svg",
  },
};

import { AuthProvider } from "@/lib/auth-context";

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
