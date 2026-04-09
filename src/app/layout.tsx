
import type { Metadata, Viewport } from "next";
import { Toaster } from "@/components/ui/toaster";
import { ErrorReporter } from "@/components/error-reporter";
import { validateServerEnv } from "@/lib/env";
import { PwaRegister } from "@/components/pwa-register";
import { NetworkStatusBanner } from "@/components/network-status";
import { PolicyViolationToaster } from "@/components/policy-violation-toaster";
import { SecurityGuard } from "@/components/security-guard";
import { ClientTimeZoneSync } from "@/components/client-timezone-sync";
import { NativeStatusBar } from "@/components/native-status-bar";
import { SafeAreaSync } from "@/components/safe-area-sync";
import { ThemeController } from "@/components/theme-controller";
import { PT_Sans } from "next/font/google";
import { themeInitScript } from "@/lib/app-theme";
import "./globals.css";

const bodyFont = PT_Sans({
  subsets: ["latin"],
  weight: ["400", "700"],
  style: ["normal", "italic"],
  display: "swap",
  variable: "--font-body",
});

export const metadata: Metadata = {
  title: "CASPO",
  description: "The ultimate group management tool, powered by AI.",
  icons: {
    icon: [
      { url: "/icon.svg", type: "image/svg+xml" },
      { url: "/favicon.ico", sizes: "any" },
    ],
    apple: "/apple-icon.png",
    shortcut: "/favicon.ico",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
  themeColor: "#ffffff",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  validateServerEnv();
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={`${bodyFont.variable} font-body antialiased`} suppressHydrationWarning>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
        <div className="app-root">
          <ThemeController />
          <NativeStatusBar />
          <SafeAreaSync />
          <ClientTimeZoneSync />
          <ErrorReporter />
          <SecurityGuard />
          <PwaRegister />
          <NetworkStatusBanner />
          <PolicyViolationToaster />
          {children}
          <Toaster />
        </div>
      </body>
    </html>
  );
}

