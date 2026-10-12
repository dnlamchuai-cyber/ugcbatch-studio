import type { Metadata } from "next";
// self-hosted Geist via the official npm package (same --font-geist-* variables) — a build-time fetch
// from Google Fonts is a network dependency that intermittently breaks CI release builds
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import "./globals.css";
import { LocaleInitializer } from "@/components/locale-initializer";
import { AppShell } from "@/components/app-shell";
import { AuthGate } from "@/components/auth-gate";

const geistSans = GeistSans;
const geistMono = GeistMono;

export const metadata: Metadata = {
  title: "UGCBatch Studio — AI UGC video ads for TikTok Shop, Shopee & Amazon",
  description:
    "Turn a product photo or one sentence into vertical UGC-style video ads: AI script, storyboard, voiceover and subtitles. Based on ClipForge (AGPL-3.0).",
  keywords: ["AI UGC video", "TikTok Shop", "Shopee", "AI video generator", "text to video", "faceless video"],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // Site-wide default dark studio theme: pin the dark class on <html>
  return (
    <html
      lang="en"
      className={`dark ${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-background text-foreground">
        <LocaleInitializer />
        <AuthGate>
          <AppShell>{children}</AppShell>
        </AuthGate>
        <footer className="py-2 text-center text-xs text-muted-foreground">
          UGCBatch Studio is free software under AGPL-3.0, based on ClipForge.{" "}
          <a className="underline" href="https://github.com/dnlamchuai-cyber/ugcbatch-studio" target="_blank" rel="noopener noreferrer">Source code</a>
        </footer>
      </body>
    </html>
  );
}
