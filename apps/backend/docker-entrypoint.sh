#!/bin/sh
set -e

echo "[entrypoint] Syncing database schema..."
npx prisma db push --accept-data-loss

echo "[entrypoint] Running seed..."
npx prisma db seed

echo "[entrypoint] Starting backend..."
exec node dist/main
