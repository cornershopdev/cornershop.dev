-- Atomically reserve article generation before model work and preserve every
-- terminal outcome in the batch ledger.
BEGIN;

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
    ALTER COLUMN "producedCount" SET DEFAULT 0;

ALTER TABLE "ArticleBatch"
    ADD COLUMN "rejectedCount" INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN "status" "ArticleBatchStatus" NOT NULL DEFAULT 'QUEUED',
    ADD COLUMN "statusReason" TEXT,
    ADD COLUMN "workflowRunId" TEXT,
    ADD COLUMN "dispatchLeaseToken" TEXT,
    ADD COLUMN "dispatchLeaseUntil" TIMESTAMP(3),
    ADD COLUMN "startedAt" TIMESTAMP(3),
    ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- The candidate deploy opens this only after the predecessor worker is
-- stopped, Workflow/Graphile are quiescent, and the new runtime is verified.
-- A rollback to the predecessor intentionally leaves the value closed.
INSERT INTO "OperatorSetting" (
    "key",
    "value",
    "updatedBy",
    "createdAt",
    "updatedAt"
)
VALUES (
    'articles.mutations.gated',
    'true'::jsonb,
    'migration:20260823110000_article_batch_admission_outcomes',
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
)
ON CONFLICT ("key") DO UPDATE
SET
    "value" = 'true'::jsonb,
    "updatedBy" = EXCLUDED."updatedBy",
    "updatedAt" = CURRENT_TIMESTAMP;

-- The workflow persisted only non-empty provider output. The manual live-proof
-- script could persist an empty array, which the old schema represented as a
-- zero requested/accepted row; retain that distinction during backfill.
UPDATE "ArticleBatch"
SET
    "rejectedCount" = GREATEST("requestedCount" - "producedCount", 0),
    "status" = CASE
        WHEN "requestedCount" = 0 THEN 'ZERO_OUTPUT'::"ArticleBatchStatus"
        WHEN "producedCount" > 0 THEN 'SUCCEEDED'::"ArticleBatchStatus"
        ELSE 'REJECTED'::"ArticleBatchStatus"
    END,
    "statusReason" = CASE
        WHEN "requestedCount" = 0 THEN 'LEGACY_ZERO_OUTPUT'
        WHEN "producedCount" > 0 THEN NULL
        ELSE 'ALL_DRAFTS_REJECTED'
    END,
    "startedAt" = "createdAt",
    "updatedAt" = COALESCE("completedAt", "createdAt");

-- Expand compatibility for an old application container that writes the
-- predecessor row shape during a rolling deploy. Its non-null completedAt is
-- the unambiguous terminal marker; new reservations leave completedAt null.
CREATE FUNCTION article_batch_expand_legacy_terminal()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF NEW."completedAt" IS NOT NULL
       AND NEW."status" = 'QUEUED'
       AND NEW."startedAt" IS NULL THEN
        NEW."rejectedCount" := GREATEST(
            NEW."requestedCount" - NEW."producedCount",
            0
        );
        NEW."status" := CASE
            WHEN NEW."requestedCount" = 0 THEN 'ZERO_OUTPUT'::"ArticleBatchStatus"
            WHEN NEW."producedCount" > 0 THEN 'SUCCEEDED'::"ArticleBatchStatus"
            ELSE 'REJECTED'::"ArticleBatchStatus"
        END;
        NEW."statusReason" := CASE
            WHEN NEW."requestedCount" = 0 THEN 'LEGACY_ZERO_OUTPUT'
            WHEN NEW."producedCount" > 0 THEN NULL
            ELSE 'ALL_DRAFTS_REJECTED'
        END;
        NEW."startedAt" := COALESCE(
            NEW."createdAt",
            NEW."completedAt",
            CURRENT_TIMESTAMP
        );
        NEW."updatedAt" := COALESCE(
            NEW."completedAt",
            NEW."createdAt",
            CURRENT_TIMESTAMP
        );
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER "ArticleBatch_expand_legacy_terminal"
BEFORE INSERT ON "ArticleBatch"
FOR EACH ROW
EXECUTE FUNCTION article_batch_expand_legacy_terminal();

CREATE UNIQUE INDEX "ArticleBatch_workflowRunId_key"
    ON "ArticleBatch"("workflowRunId");

CREATE INDEX "ArticleBatch_siteId_status_createdAt_idx"
    ON "ArticleBatch"("siteId", "status", "createdAt");

CREATE INDEX "ArticleBatch_dispatch_queue_idx"
    ON "ArticleBatch"(
        "status",
        "workflowRunId",
        "dispatchLeaseUntil",
        "createdAt"
    );

CREATE UNIQUE INDEX "ArticleBatch_one_active_per_site_key"
    ON "ArticleBatch"("siteId")
    WHERE "status" IN ('QUEUED', 'RUNNING');

COMMIT;
