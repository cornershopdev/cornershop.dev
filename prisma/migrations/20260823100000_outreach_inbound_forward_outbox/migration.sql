BEGIN;

CREATE TYPE "OutreachInboundForwardStatus" AS ENUM (
  'PENDING',
  'SENT',
  'EXHAUSTED'
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
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "deliveryLeaseUntil" TIMESTAMP(3),
  "deliveryLeaseToken" TEXT,
  "firstProviderAttemptAt" TIMESTAMP(3),
  "sentAt" TIMESTAMP(3),
  "providerMessageId" TEXT,
  "lastFailureCode" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "OutreachInboundForward_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "OutreachInboundForward_outreachMessageId_key"
ON "OutreachInboundForward"("outreachMessageId");

CREATE UNIQUE INDEX "OutreachInboundForward_idempotencyKey_key"
ON "OutreachInboundForward"("idempotencyKey");

CREATE INDEX "OutreachInboundForward_status_nextAttemptAt_idx"
ON "OutreachInboundForward"("status", "nextAttemptAt");

ALTER TABLE "OutreachInboundForward"
ADD CONSTRAINT "OutreachInboundForward_outreachMessageId_fkey"
FOREIGN KEY ("outreachMessageId") REFERENCES "OutreachMessage"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

COMMIT;
