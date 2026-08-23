BEGIN;

CREATE TYPE "OutreachInboundForwardStatus" AS ENUM (
  'PENDING',
  'SENT',
  'EXHAUSTED'
);

CREATE TYPE "OutreachInboundForwardDeliveryStatus" AS ENUM (
  'PENDING',
  'SENT',
  'DELIVERED',
  'BOUNCED',
  'COMPLAINED',
  'SUPPRESSED',
  'FAILED'
);

CREATE TABLE "OutreachInboundForward" (
  "id" TEXT NOT NULL,
  "outreachMessageId" TEXT NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "targetAddress" TEXT,
  "senderAddress" TEXT NOT NULL,
  "siteName" TEXT NOT NULL,
  "siteSlug" TEXT NOT NULL,
  "status" "OutreachInboundForwardStatus" NOT NULL DEFAULT 'PENDING',
  "deliveryStatus" "OutreachInboundForwardDeliveryStatus" NOT NULL DEFAULT 'PENDING',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "deliveryLeaseUntil" TIMESTAMP(3),
  "deliveryLeaseToken" TEXT,
  "firstProviderAttemptAt" TIMESTAMP(3),
  "sentAt" TIMESTAMP(3),
  "deliveredAt" TIMESTAMP(3),
  "providerMessageId" TEXT,
  "providerEventAt" TIMESTAMP(3),
  "lastFailureCode" TEXT,
  "deliveryFailureCode" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "OutreachInboundForward_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "OutreachInboundForward_outreachMessageId_key"
ON "OutreachInboundForward"("outreachMessageId");

CREATE UNIQUE INDEX "OutreachInboundForward_idempotencyKey_key"
ON "OutreachInboundForward"("idempotencyKey");

CREATE UNIQUE INDEX "OutreachInboundForward_providerMessageId_key"
ON "OutreachInboundForward"("providerMessageId");

CREATE INDEX "OutreachInboundForward_status_nextAttemptAt_idx"
ON "OutreachInboundForward"("status", "nextAttemptAt");

CREATE TABLE "OutreachForwardProviderEvent" (
  "id" TEXT NOT NULL,
  "forwardId" TEXT NOT NULL,
  "providerMessageId" TEXT NOT NULL,
  "eventType" TEXT NOT NULL,
  "deliveryStatus" "OutreachInboundForwardDeliveryStatus" NOT NULL,
  "occurredAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "OutreachForwardProviderEvent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "OutreachForwardProviderEvent_forwardId_occurredAt_idx"
ON "OutreachForwardProviderEvent"("forwardId", "occurredAt");

CREATE INDEX "OutreachForwardEvent_providerMessageId_occurredAt_idx"
ON "OutreachForwardProviderEvent"("providerMessageId", "occurredAt");

ALTER TABLE "OutreachInboundForward"
ADD CONSTRAINT "OutreachInboundForward_outreachMessageId_fkey"
FOREIGN KEY ("outreachMessageId") REFERENCES "OutreachMessage"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "OutreachForwardProviderEvent"
ADD CONSTRAINT "OutreachForwardProviderEvent_forwardId_fkey"
FOREIGN KEY ("forwardId") REFERENCES "OutreachInboundForward"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

COMMIT;
