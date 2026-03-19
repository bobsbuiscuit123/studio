
import type { Metadata, Viewport } from "next";
import { Toaster } from "@/components/ui/toaster";
import { ErrorReporter } from "@/components/error-reporter";
import { validateServerEnv } from "@/lib/env";
import { PwaRegister } from "@/components/pwa-register";
import { NetworkStatusBanner } from "@/components/network-status";
import { PolicyViolationToaster } from "@/components/policy-violation-toaster";
import { SecurityGuard } from "@/components/security-guard";
import { ClientTimeZoneSync } from "@/components/client-timezone-sync";
import "./globals.css";

export const metadata: Metadata = {
  title: "CASPO",
  description: "The ultimate group management tool, powered by AI.",
  icons: {
    icon: "/icon.svg",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
  themeColor: "#f6faf4",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  validateServerEnv();
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=PT+Sans:ital,wght@0,400;0,700;1,400;1,700&display=swap" rel="stylesheet" />
      </head>
      <body className="font-body antialiased" suppressHydrationWarning>
        <ClientTimeZoneSync />
        <ErrorReporter />
        <SecurityGuard />
        <PwaRegister />
        <NetworkStatusBanner />
        <PolicyViolationToaster />
        {children}
        <Toaster />
      </body>
    </html>
  );
}

