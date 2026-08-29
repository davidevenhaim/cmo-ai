# Context: monorepo root (./). Set in docker-compose.yml.
FROM node:20-alpine AS builder
WORKDIR /app

# Prisma's schema/query engines are dynamically linked against OpenSSL, which
# node:20-alpine does not ship. Without it `prisma generate` and `prisma db push`
# fail with "Could not parse schema engine response".
RUN apk add --no-cache openssl

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

# Generate the Prisma client BEFORE compiling. Every Prisma model delegate is
# typed by the generated client; without this `nest build` fails with ~98
# implicit-any / never errors.
ENV DATABASE_URL=postgresql://placeholder:placeholder@localhost:5432/placeholder
RUN cd apps/backend && npx prisma generate

# Build backend
RUN cd apps/backend && npm run build

# Precompile the seed. `prisma db seed` shells out to ts-node, which npm installs
# into apps/backend/node_modules (not the hoisted root one the runtime stage
# copies), so the runtime image runs a compiled seed instead.
RUN cd apps/backend && npx tsc prisma/seed.ts \
      --outDir prisma-dist --module commonjs --target ES2020 \
      --esModuleInterop --skipLibCheck

FROM node:20-alpine
WORKDIR /app
RUN apk add --no-cache curl openssl

# Backend compiled output
COPY --from=builder /app/apps/backend/dist ./dist

# Root node_modules (contains @ai-cmo/contracts symlink → packages/contracts,
# and the generated .prisma client)
COPY --from=builder /app/node_modules ./node_modules

# Contracts dist — target of the @ai-cmo/contracts workspace symlink
COPY --from=builder /app/packages/contracts/dist ./packages/contracts/dist
COPY --from=builder /app/packages/contracts/package.json ./packages/contracts/package.json

# package.json carries the `prisma.seed` config that `prisma db seed` reads;
# tsconfig.json is what ts-node uses to run prisma/seed.ts.
COPY --from=builder /app/apps/backend/package.json ./package.json
COPY --from=builder /app/apps/backend/tsconfig.json ./tsconfig.json

# Prisma schema + entrypoint
COPY --from=builder /app/apps/backend/prisma ./prisma
COPY --from=builder /app/apps/backend/prisma-dist ./prisma-dist
COPY apps/backend/docker-entrypoint.sh ./docker-entrypoint.sh
RUN chmod +x docker-entrypoint.sh

EXPOSE 3001
ENTRYPOINT ["./docker-entrypoint.sh"]
