#!/bin/sh
set -e

echo "[entrypoint] Syncing database schema..."
npx prisma db push --accept-data-loss

echo "[entrypoint] Running seed..."
node prisma-dist/seed.js

echo "[entrypoint] Starting backend..."
exec node dist/main
