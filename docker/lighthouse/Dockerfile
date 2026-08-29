# Self-hosted Lighthouse runner.
#
# Alpine ships a Chromium build, so this stays a single small image rather than
# pulling a third-party Lighthouse SaaS or a second browser container. The
# backend talks to it over the internal compose network only.
FROM node:20-alpine

RUN apk add --no-cache chromium nss freetype harfbuzz ca-certificates ttf-freefont curl

# chrome-launcher must use the distro Chromium, not download its own.
ENV CHROME_PATH=/usr/bin/chromium-browser
ENV PUPPETEER_SKIP_DOWNLOAD=true

WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund

COPY server.js ./

# Chromium refuses to run headless as root without --no-sandbox; we pass that
# flag, but dropping privileges anyway keeps the blast radius small.
RUN addgroup -S lh && adduser -S lh -G lh && chown -R lh:lh /app
USER lh

EXPOSE 3010
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD curl -fsS http://localhost:3010/health || exit 1

CMD ["node", "server.js"]
