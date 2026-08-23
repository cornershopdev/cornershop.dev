FROM oven/bun:1.3.14-alpine AS bun-source

FROM node:24.19.0-alpine3.24 AS node-toolchain
ENV BUN_RUNTIME_TRANSPILER_CACHE_PATH=0

# Next builds and serves on the pinned Node LTS. Bun remains available for
# dependency installation, Prisma/Workflow migrations, and operator bundles.
COPY --from=bun-source /usr/local/bin/bun /usr/local/bin/bun
RUN apk add --no-cache libgcc libstdc++ \
  && ln -s /usr/local/bin/bun /usr/local/bin/bunx \
  && test "$(node --version)" = "v24.19.0" \
  && test "$(bun --version)" = "1.3.14"

FROM node-toolchain AS dependencies
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
ARG DATABASE_URL=postgresql://build:build@127.0.0.1:5432/cornershopdev_build
ENV DATABASE_URL=$DATABASE_URL
COPY package.json bun.lock ./
COPY prisma ./prisma
COPY prisma.config.ts ./
RUN bun install --frozen-lockfile
# Fail the image build on the production musl architecture if Sharp's native
# decoder cannot load and perform the encode/decode path used by the Node Open
# Graph runtime.
RUN node --input-type=module -e 'import sharp from "sharp"; const encoded = await sharp({ create: { width: 1, height: 1, channels: 3, background: "#000000" } }).jpeg().toBuffer(); const decoded = await sharp(encoded).resize(1, 1).toBuffer(); if (encoded.length === 0 || decoded.length === 0) throw new Error("Sharp runtime smoke test failed")'

FROM dependencies AS builder
WORKDIR /app
ENV NODE_ENV=production
ENV WORKFLOW_TARGET_WORLD=@workflow/world-postgres
COPY . .
# Runtime secrets are injected by the host environment. Next evaluates auth
# routes while collecting page data, so the builder gets a non-production
# placeholder that is not inherited by the runner stage.
RUN BETTER_AUTH_SECRET=build-only-better-auth-secret-32-bytes bun run build
RUN bun build scripts/grant-superadmin.ts \
  --target=bun \
  --packages=external \
  --outfile=.operator-scripts/grant-superadmin.ts
RUN bun build scripts/import-le-petit-meunier.ts \
  --target=bun \
  --packages=external \
  --outfile=.operator-scripts/import-le-petit-meunier.ts
RUN bun build scripts/import-servizo.ts \
  --target=bun \
  --packages=external \
  --outfile=.operator-scripts/import-servizo.ts
RUN bun build scripts/issue-servizo-claim-invitation.ts \
  --target=bun \
  --packages=external \
  --outfile=.operator-scripts/issue-servizo-claim-invitation.ts
RUN bun build scripts/verify-environment-isolation.ts \
  --target=bun \
  --packages=external \
  --outfile=.operator-scripts/verify-environment-isolation.ts
RUN bun build scripts/verify-image-storage-roundtrip.ts \
  --target=bun \
  --packages=external \
  --outfile=.operator-scripts/verify-image-storage-roundtrip.ts
RUN bun build scripts/dispatch-operator-alerts.ts \
  --target=bun \
  --packages=external \
  --outfile=.operator-scripts/dispatch-operator-alerts.ts
RUN bun build scripts/dispatch-inbound-forwards.ts \
  --target=bun \
  --packages=external \
  --outfile=.operator-scripts/dispatch-inbound-forwards.ts
RUN bun build scripts/monitor-public-site.ts \
  --target=bun \
  --packages=external \
  --outfile=.operator-scripts/monitor-public-site.ts
RUN bun build scripts/preflight-outreach.ts \
  --target=bun \
  --packages=external \
  --outfile=.operator-scripts/preflight-outreach.ts
RUN bun build scripts/preflight-platform-edge.ts \
  --target=bun \
  --packages=external \
  --outfile=.operator-scripts/preflight-platform-edge.ts
RUN bun build scripts/preflight-stripe-billing.ts \
  --target=bun \
  --packages=external \
  --outfile=.operator-scripts/preflight-stripe-billing.ts
RUN bun build scripts/preflight-first-customer-migration.ts \
  --target=bun \
  --packages=external \
  --outfile=.operator-scripts/preflight-first-customer-migration.ts
RUN bun build scripts/verify-first-customer-production.ts \
  --target=bun \
  --packages=external \
  --outfile=.operator-scripts/verify-first-customer-production.ts

FROM node-toolchain AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV HOSTNAME=0.0.0.0
ENV PORT=3000
ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_EXTRA_CA_CERTS=/app/certs/aws-rds-global-bundle.pem

ADD --checksum=sha256:e5bb2084ccf45087bda1c9bffdea0eb15ee67f0b91646106e466714f9de3c7e3 \
  https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem \
  /app/certs/aws-rds-global-bundle.pem
RUN chmod 0444 /app/certs/aws-rds-global-bundle.pem

COPY --from=builder --chown=node:node /app/node_modules ./node_modules
COPY --from=builder --chown=node:node /app/.next/standalone ./
COPY --from=builder --chown=node:node /app/.next/static ./.next/static
COPY --from=builder --chown=node:node /app/public ./public
COPY --from=builder --chown=node:node /app/prisma ./prisma
COPY --from=builder --chown=node:node /app/prisma.config.ts ./prisma.config.ts
COPY --from=builder --chown=node:node /app/package.json ./package.json
COPY --from=builder --chown=node:node /app/.operator-scripts ./scripts
COPY --chown=node:node deploy/aws/container-entrypoint.sh ./deploy/aws/container-entrypoint.sh

USER node
EXPOSE 3000
HEALTHCHECK --interval=10s --timeout=5s --start-period=60s --retries=18 \
  CMD wget --header="Authorization: Bearer ${HEALTHCHECK_TOKEN}" \
    -qO- http://127.0.0.1:3000/api/health/ready >/dev/null || exit 1
ENTRYPOINT ["/app/deploy/aws/container-entrypoint.sh"]
