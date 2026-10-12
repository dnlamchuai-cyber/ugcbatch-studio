#!/usr/bin/env bash
# Preview deploy for UGCBatch Studio on Vercel (Hobby plan: remote builds exceed 12 functions, so build locally
# and upload prebuilt). Vercel runs Node 24 (ABI 137) on glibc < 2.38, so swap in the official better-sqlite3
# prebuilt (glibc 2.29) for the deploy, then restore the local binary.
set -euo pipefail
V=12.11.1; B=node_modules/better-sqlite3/build/Release/better_sqlite3.node; T=$(mktemp -d)
curl -sL "https://github.com/WiseLibs/better-sqlite3/releases/download/v$V/better-sqlite3-v$V-node-v137-linux-x64.tar.gz" | tar xz -C "$T"
cp "$B" "$T/local.node"; trap 'cp "$T/local.node" "$B"' EXIT
cp "$T/build/Release/better_sqlite3.node" "$B"
rm -rf .vercel/output
npx -y vercel@latest build --yes --token "$VERCEL_TOKEN"
npx -y vercel@latest deploy --prebuilt --yes --token "$VERCEL_TOKEN"
