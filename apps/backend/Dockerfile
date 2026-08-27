# Context: monorepo root (./). Set in docker-compose.yml.
FROM node:20-alpine AS builder
WORKDIR /app

# Copy workspace manifests first for layer caching
COPY package*.json ./
COPY packages/contracts/package*.json ./packages/contracts/
COPY apps/backend/package*.json ./apps/backend/

# Install all workspace deps from root
RUN npm install

# Copy source
COPY packages/contracts/ ./packages/contracts/
COPY apps/backend/ ./apps/backend/

# Build contracts to JS so backend can require('@ai-cmo/contracts') at runtime
RUN cd packages/contracts && npm run build

# Build backend
RUN cd apps/backend && npm run build

FROM node:20-alpine
WORKDIR /app
RUN apk add --no-cache curl

# Backend compiled output
COPY --from=builder /app/apps/backend/dist ./dist

# Root node_modules (contains @ai-cmo/contracts symlink → packages/contracts)
COPY --from=builder /app/node_modules ./node_modules

# Contracts dist — target of the @ai-cmo/contracts workspace symlink
COPY --from=builder /app/packages/contracts/dist ./packages/contracts/dist
COPY --from=builder /app/packages/contracts/package.json ./packages/contracts/package.json

# Prisma schema + entrypoint
COPY --from=builder /app/apps/backend/prisma ./prisma
COPY apps/backend/docker-entrypoint.sh ./docker-entrypoint.sh
RUN chmod +x docker-entrypoint.sh

EXPOSE 3001
ENTRYPOINT ["./docker-entrypoint.sh"]
