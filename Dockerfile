# syntax=docker/dockerfile:1
# UGCBatch Studio self-hosted image: Next standalone + Debian ffmpeg + bundled Vietnamese/English subtitle font.
# Data (SQLite, uploads, output) lives in the /data volume.
#   docker build -t ugcbatch .
#   docker run -d -p 3000:3000 -v ugcbatch-data:/data ugcbatch
# Then open http://localhost:3000

# ---- build stage ----
FROM node:22-bookworm-slim AS builder
WORKDIR /app
# better-sqlite3 is a native module and needs a build toolchain
RUN apt-get update && apt-get install -y --no-install-recommends -o Acquire::Retries=5 python3 make g++ \
  && rm -rf /var/lib/apt/lists/*
RUN corepack enable
COPY package.json pnpm-lock.yaml ./
# The container only runs the web app, so skip the Electron binary download
ENV ELECTRON_SKIP_BINARY_DOWNLOAD=1
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm build

# ---- runtime stage ----
FROM node:22-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
# Use Debian's ffmpeg: the ffmpeg-static npm binary lacks harfbuzz and therefore the drawtext filter,
# which subtitles, price tags, covers and end cards all depend on.
RUN apt-get update && apt-get install -y --no-install-recommends -o Acquire::Retries=5 ffmpeg \
  && rm -rf /var/lib/apt/lists/* \
  && ffmpeg -hide_banner -filters 2>/dev/null | grep -q ' drawtext ' \
  || (echo "FATAL: ffmpeg lacks the drawtext filter — subtitle/text composition would break" && exit 1)
# Subtitle font is bundled at public/fonts/subtitle.ttf (Be Vietnam Pro), no system font package needed.
# Next standalone output (minimal server.js + required node_modules, including better-sqlite3)
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public
# Drizzle migrations are read at runtime and not traced by nft, so copy them explicitly
COPY --from=builder /app/drizzle ./drizzle
ENV APP_DATA_DIR=/data
RUN mkdir -p /data
VOLUME /data
ENV PORT=3000 HOSTNAME=0.0.0.0
EXPOSE 3000
CMD ["node", "server.js"]
