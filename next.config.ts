import type { NextConfig } from "next";

// Heavy native media/ML binaries excluded from Vercel serverless bundles (see outputFileTracingExcludes)
const VERCEL_HEAVY = ["./node_modules/onnxruntime-node/**", "./node_modules/onnxruntime-web/**", "./node_modules/@huggingface/**", "./node_modules/ffmpeg-static/**", "./node_modules/@ffprobe-installer/**", "./node_modules/electron/**", "./node_modules/@remotion/**"];

const nextConfig: NextConfig = {
  // standalone output: next build additionally emits .next/standalone (minimal server.js + nft-traced dependency subset),
  // used by the Electron main process to fork-start the server without requiring npm install on the user's machine. Does not affect next dev.
  output: process.env.VERCEL ? undefined : "standalone",
  // better-sqlite3 is a native module; mark it external (loaded via require, so the bundler won't try to bundle its .node file)
  serverExternalPackages: ["better-sqlite3"],
  // ssrf-guard needs Node's dns/net; shared modules that also land in client bundles get a
  // pass-through browser build (SSRF is a server-side concern; server code always uses the real guard).
  turbopack: {
    resolveAlias: {
      "@/lib/ssrf-guard": { browser: "./src/lib/ssrf-guard.browser.ts" },
    },
  },
  // Keep the file trace honest: nft's conservative directory collection was dragging the local
  // data/ (user uploads/outputs — 96MB of it), the docs site and other repo-only folders into
  // .next/standalone, which then shipped inside every desktop installer (issue: 330MB dmg).
  // data/ is a runtime-created directory (Electron uses userData anyway), never a build input.
  // drizzle/ SQL migrations are read at runtime via fs (needed on Vercel serverless)
  outputFileTracingIncludes: {
    "/**": ["./drizzle/**"],
  },
  outputFileTracingExcludes: {
    // Vercel serverless: drop heavy native media/ML binaries (local ASR, ffmpeg rendering) so routes
    // fit and group into few functions; those features need the desktop/self-hosted build.
    "/**": ["./.git/**", "./.vercel/**", "./.github/**", "./data/**", "./docs/**", "./tasks/**", "./release/**", "./integrations/**", "./e2e/**", "./remotion/**", ...(process.env.VERCEL ? VERCEL_HEAVY : [])],
  },
};

export default nextConfig;
