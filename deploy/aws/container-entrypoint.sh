#!/bin/sh
set -eu

if [ "${CORNERSHOP_SKIP_STARTUP_MIGRATIONS:-false}" != "true" ]; then
  bun run db:migrate:deploy
  bun run workflow:migrate
fi
exec node server.js
