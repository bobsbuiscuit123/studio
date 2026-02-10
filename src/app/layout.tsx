
import type { Metadata } from "next";
import { Toaster } from "@/components/ui/toaster";
import { ErrorReporter } from "@/components/error-reporter";
import { validateServerEnv } from "@/lib/env";
import { PwaRegister } from "@/components/pwa-register";
import "./globals.css";

export const metadata: Metadata = {
  title: "ClubHub AI",
  description: "The ultimate club management tool, powered by AI.",
  icons: {
    icon: "/icon.svg",
  },
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
        <ErrorReporter />
        <PwaRegister />
        {children}
        <Toaster />
      </body>
    </html>
  );
}
