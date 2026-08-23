-- Atomically reserve article generation before model work and preserve every
-- terminal outcome in the batch ledger.
CREATE TYPE "ArticleBatchStatus" AS ENUM (
    'QUEUED',
    'RUNNING',
    'SUCCEEDED',
    'ZERO_OUTPUT',
    'REJECTED',
    'SKIPPED',
    'FAILED'
);

ALTER TABLE "ArticleBatch"
    RENAME COLUMN "producedCount" TO "acceptedCount";

ALTER TABLE "ArticleBatch"
    ALTER COLUMN "acceptedCount" SET DEFAULT 0;

ALTER TABLE "ArticleBatch"
    ADD COLUMN "rejectedCount" INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN "status" "ArticleBatchStatus" NOT NULL DEFAULT 'QUEUED',
    ADD COLUMN "statusReason" TEXT,
    ADD COLUMN "workflowRunId" TEXT,
    ADD COLUMN "startedAt" TIMESTAMP(3),
    ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- The workflow persisted only non-empty provider output. The manual live-proof
-- script could persist an empty array, which the old schema represented as a
-- zero requested/accepted row; retain that distinction during backfill.
UPDATE "ArticleBatch"
SET
    "rejectedCount" = GREATEST("requestedCount" - "acceptedCount", 0),
    "status" = CASE
        WHEN "requestedCount" = 0 THEN 'ZERO_OUTPUT'::"ArticleBatchStatus"
        WHEN "acceptedCount" > 0 THEN 'SUCCEEDED'::"ArticleBatchStatus"
        ELSE 'REJECTED'::"ArticleBatchStatus"
    END,
    "statusReason" = CASE
        WHEN "requestedCount" = 0 THEN 'LEGACY_ZERO_OUTPUT'
        WHEN "acceptedCount" > 0 THEN NULL
        ELSE 'ALL_DRAFTS_REJECTED'
    END,
    "startedAt" = "createdAt",
    "updatedAt" = COALESCE("completedAt", "createdAt");

ALTER TABLE "ArticleBatch"
    ALTER COLUMN "updatedAt" DROP DEFAULT;

CREATE UNIQUE INDEX "ArticleBatch_workflowRunId_key"
    ON "ArticleBatch"("workflowRunId");

CREATE INDEX "ArticleBatch_siteId_status_createdAt_idx"
    ON "ArticleBatch"("siteId", "status", "createdAt");

CREATE UNIQUE INDEX "ArticleBatch_one_active_per_site_key"
    ON "ArticleBatch"("siteId")
    WHERE "status" IN ('QUEUED', 'RUNNING');
