import "server-only";
import { Prisma } from "@/generated/prisma/client";
import type {
  IntegrationType,
  SourceMonitorSuggestionField,
  Vertical,
} from "@/generated/prisma/enums";
import { z } from "zod";
import { configuredSuperadminEmails } from "@/lib/superadmin-config";
import { getDb } from "@/lib/db";
import { sameJsonValue } from "@/lib/evidence-digests";
import { inspectPublicLink } from "@/lib/importer";
import { emailReplyTo, emailSender } from "@/lib/email-identity";
import { getResend } from "@/lib/resend";
import {
  buildSourceMonitoringDiff,
  EMPTY_SOURCE_MONITORING_DASHBOARD,
  linksSuggestionSchema,
  menuSuggestionSchema,
  monitoringFieldValue,
  parseSourceMonitoringSuggestionValue,
  SourceMonitoringUnsupportedSuggestionError,
  type MonitoringSuggestionInput,
  type SourceEvidence,
  type SourceMonitoringDashboardDto,
} from "@/lib/source-monitoring-diff";
import {
  monitoringEntitlement,
  monitoringIdempotencyKey,
  nextMonitoringTime,
} from "@/lib/source-monitoring-plan";
import {
  DraftRevisionConflictError,
  type PersistableSiteDraft,
} from "@/lib/site-persistence";
import { projectSiteDraft, siteDraftRelations } from "@/lib/sites";
import { crawlSiteSource, generateDraftForVertical } from "@/lib/site-pipeline";
import { businessHoursSchema } from "@/lib/verticals/schema";
import { resolveVerticalConfig } from "@/lib/verticals/registry";
import type { VerticalId } from "@/lib/verticals/types";

export {
  EMPTY_SOURCE_MONITORING_DASHBOARD,
  SourceMonitoringUnsupportedSuggestionError,
  type SourceMonitoringDashboardDto,
};

const DAY_MS = 24 * 60 * 60_000;
const MAX_DISPATCH = 200;
const contactSchema = z.object({
  address: z.string().max(220),
  phone: z.string().max(40),
});

export class SourceMonitoringConflictError extends Error {
  constructor() {
    super("The draft changed after this suggestion was created");
    this.name = "SourceMonitoringConflictError";
  }
}

export async function dispatchDueSourceMonitoring(
  now = new Date(),
  startRun: (runId: string) => Promise<string> = startMonitoringWorkflow,
): Promise<{ claimed: number; started: number; failedToStart: number }> {
  const db = getDb();
  const subscriptions = await db.subscription.findMany({
    where: {
      status: "ACTIVE",
      site: {
        sourceUrl: { not: null },
        status: { not: "PAUSED" },
      },
    },
    take: MAX_DISPATCH,
    orderBy: { updatedAt: "asc" },
    select: {
      stripePriceId: true,
      status: true,
      site: { select: { id: true, status: true } },
    },
  });

  const claimedIds: string[] = [];
  for (const subscription of subscriptions) {
    const entitlement = monitoringEntitlement({
      status: subscription.status,
      stripePriceId: subscription.stripePriceId,
      siteStatus: subscription.site.status,
    });
    if (!entitlement.active) continue;

    const runId = await db.$transaction(
      async (transaction) => {
        const state = await transaction.sourceMonitorState.findUnique({
          where: { siteId: subscription.site.id },
        });
        const scheduledFor = state?.nextRunAt ?? now;
        if (state && scheduledFor > now) {
          if (state.cadenceDays !== entitlement.cadenceDays) {
            await transaction.sourceMonitorState.update({
              where: { siteId: subscription.site.id },
              data: {
                cadenceDays: entitlement.cadenceDays,
                nextRunAt: nextMonitoringTime(
                  state.lastRunAt ?? now,
                  entitlement.cadenceDays,
                  now,
                ),
              },
            });
          }
          return null;
        }

        const run = await transaction.sourceMonitorRun.upsert({
          where: {
            idempotencyKey: monitoringIdempotencyKey(
              subscription.site.id,
              scheduledFor,
            ),
          },
          update: {},
          create: {
            siteId: subscription.site.id,
            scheduledFor,
            idempotencyKey: monitoringIdempotencyKey(
              subscription.site.id,
              scheduledFor,
            ),
          },
          select: { id: true },
        });
        await transaction.sourceMonitorState.upsert({
          where: { siteId: subscription.site.id },
          update: {
            cadenceDays: entitlement.cadenceDays,
            nextRunAt: nextMonitoringTime(
              scheduledFor,
              entitlement.cadenceDays,
              now,
            ),
            lastRunAt: now,
            lastRunId: run.id,
          },
          create: {
            siteId: subscription.site.id,
            cadenceDays: entitlement.cadenceDays,
            nextRunAt: nextMonitoringTime(
              scheduledFor,
              entitlement.cadenceDays,
              now,
            ),
            lastRunAt: now,
            lastRunId: run.id,
          },
        });
        return run.id;
      },
      { isolationLevel: "Serializable" },
    );
    if (runId) claimedIds.push(runId);
  }

  const queued = await db.sourceMonitorRun.findMany({
    where: {
      status: "QUEUED",
      workflowRunId: null,
    },
    orderBy: { createdAt: "asc" },
    take: MAX_DISPATCH,
    select: { id: true },
  });
  let started = 0;
  let failedToStart = 0;
  for (const run of queued) {
    try {
      const workflowRunId = await startRun(run.id);
      await db.sourceMonitorRun.updateMany({
        where: {
          id: run.id,
          status: "QUEUED",
          workflowRunId: null,
        },
        data: { workflowRunId },
      });
      started += 1;
    } catch {
      // The durable QUEUED row remains eligible for the next dispatcher pass.
      failedToStart += 1;
    }
  }
  return { claimed: claimedIds.length, started, failedToStart };
}

export async function beginSourceMonitoringRun(runId: string) {
  const db = getDb();
  return db.$transaction(
    async (transaction) => {
      const run = await transaction.sourceMonitorRun.findUnique({
        where: { id: runId },
        select: {
          id: true,
          status: true,
          site: {
            select: {
              id: true,
              slug: true,
              vertical: true,
              status: true,
              sourceUrl: true,
              subscription: {
                select: { status: true, stripePriceId: true },
              },
            },
          },
        },
      });
      if (!run || run.status !== "QUEUED") return null;
      const entitlement = monitoringEntitlement({
        status: run.site.subscription?.status ?? null,
        stripePriceId: run.site.subscription?.stripePriceId ?? null,
        siteStatus: run.site.status,
      });
      if (!entitlement.active || !run.site.sourceUrl) {
        await transaction.sourceMonitorRun.update({
          where: { id: run.id },
          data: {
            status: "SKIPPED",
            completedAt: new Date(),
            errorCode: entitlement.active
              ? "SOURCE_MISSING"
              : entitlement.reason,
          },
        });
        return null;
      }
      await transaction.sourceMonitorRun.update({
        where: { id: run.id },
        data: { status: "RUNNING", startedAt: new Date(), errorCode: null },
      });
      return {
        runId: run.id,
        siteId: run.site.id,
        slug: run.site.slug,
        vertical: run.site.vertical,
        sourceUrl: run.site.sourceUrl,
      };
    },
    { isolationLevel: "Serializable" },
  );
}

export async function executeSourceMonitoringRun(context: {
  runId: string;
  siteId: string;
  slug: string;
  vertical: VerticalId;
  sourceUrl: string;
}): Promise<{ suggestionCount: number }> {
  const db = getDb();
  const existing = await db.sourceMonitorRun.findUnique({
    where: { id: context.runId },
    select: { status: true, suggestionCount: true },
  });
  if (existing?.status === "SUCCEEDED") {
    return { suggestionCount: existing.suggestionCount };
  }
  if (existing?.status !== "RUNNING") {
    throw new Error("Source monitoring run is not executable");
  }

  const site = await db.site.findUnique({
    where: { id: context.siteId, slug: context.slug },
    include: siteDraftRelations,
  });
  if (!site) throw new Error("Source monitoring site not found");
  const current = projectSiteDraft(site).draft as PersistableSiteDraft;
  const extracted = await crawlSiteSource(context.sourceUrl, context.vertical);
  const proposed = await generateDraftForVertical(extracted, context.vertical);
  const linkUrls = [
    ...new Set([
      ...current.integrations.map((link) => link.url),
      ...extracted.links.map((link) => link.url),
    ]),
  ];
  const checkedLinkResults = await Promise.allSettled(
    linkUrls.map(inspectPublicLink),
  );
  const checkedLinks = checkedLinkResults.flatMap((result) =>
    result.status === "fulfilled" ? [result.value] : [],
  );
  const suggestions = buildSourceMonitoringDiff({
    current,
    proposed,
    extracted,
    checkedLinks,
    capturedAt: new Date(),
  });

  await persistSuccessfulRun(
    context,
    suggestions,
    1 + checkedLinks.length,
    checkedLinkResults.length - checkedLinks.length,
  );
  return { suggestionCount: suggestions.length };
}

export async function failSourceMonitoringRun(
  runId: string,
  error: unknown,
): Promise<void> {
  const errorCode = safeMonitoringErrorCode(error);
  const now = new Date();
  await getDb().$transaction(async (transaction) => {
    const run = await transaction.sourceMonitorRun.findUnique({
      where: { id: runId },
      select: { siteId: true, status: true },
    });
    if (!run || !["QUEUED", "RUNNING"].includes(run.status)) return;
    await transaction.sourceMonitorRun.update({
      where: { id: runId },
      data: { status: "FAILED", completedAt: now, errorCode },
    });
    await transaction.sourceMonitorState.updateMany({
      where: { siteId: run.siteId },
      data: {
        lastFailureAt: now,
        lastFailureCode: errorCode,
      },
    });
  });
}

export async function notifySourceMonitoringReview(
  runId: string,
): Promise<boolean> {
  const db = getDb();
  const run = await db.sourceMonitorRun.findUnique({
    where: { id: runId },
    select: {
      id: true,
      status: true,
      suggestionCount: true,
      notificationSentAt: true,
      site: {
        select: {
          name: true,
          slug: true,
          vertical: true,
          organization: {
            select: {
              memberships: {
                select: { user: { select: { email: true } } },
              },
            },
          },
        },
      },
    },
  });
  if (
    !run ||
    run.status !== "SUCCEEDED" ||
    run.suggestionCount === 0 ||
    run.notificationSentAt
  ) {
    return false;
  }
  const recipients = [
    ...new Set([
      ...(run.site.organization?.memberships.map(
        (membership) => membership.user.email,
      ) ?? []),
      ...configuredSuperadminEmails(),
    ]),
  ];
  if (!process.env.RESEND_API_KEY || recipients.length === 0) {
    await db.sourceMonitorRun.updateMany({
      where: { id: run.id, notificationSentAt: null },
      data: { notificationFailureCode: "NOT_CONFIGURED" },
    });
    return false;
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "https://cornershop.dev";
  const { error } = await getResend().emails.send(
    {
      from: emailSender(run.site.vertical),
      replyTo: emailReplyTo(run.site.vertical),
      to: recipients,
      subject: `${run.suggestionCount} source update${run.suggestionCount === 1 ? "" : "s"} to review for ${run.site.name}`,
      html: sourceMonitoringEmailHtml({
        siteName: run.site.name,
        count: run.suggestionCount,
        reviewUrl: `${appUrl.replace(/\/$/, "")}/dashboard`,
      }),
    },
    { headers: { "Idempotency-Key": `source-monitor-${run.id}` } },
  );
  if (error) {
    await db.sourceMonitorRun.updateMany({
      where: { id: run.id, notificationSentAt: null },
      data: { notificationFailureCode: "DELIVERY_FAILED" },
    });
    throw new Error("Source monitoring notification failed");
  }
  await db.sourceMonitorRun.updateMany({
    where: { id: run.id, notificationSentAt: null },
    data: { notificationSentAt: new Date(), notificationFailureCode: null },
  });
  return true;
}

export async function getSourceMonitoringDashboard(
  siteId: string,
): Promise<SourceMonitoringDashboardDto> {
  const db = getDb();
  const [state, latestRun, suggestions] = await Promise.all([
    db.sourceMonitorState.findUnique({ where: { siteId } }),
    db.sourceMonitorRun.findFirst({
      where: { siteId },
      orderBy: [{ scheduledFor: "desc" }, { id: "desc" }],
      select: {
        id: true,
        status: true,
        scheduledFor: true,
        completedAt: true,
        suggestionCount: true,
        checkedSourceCount: true,
        failedSourceCount: true,
        notificationFailureCode: true,
      },
    }),
    db.sourceMonitorSuggestion.findMany({
      where: { siteId, status: "PENDING" },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 50,
      select: {
        id: true,
        field: true,
        path: true,
        currentValue: true,
        suggestedValue: true,
        editedValue: true,
        evidence: true,
        status: true,
        createdAt: true,
      },
    }),
  ]);
  return {
    cadenceDays: state?.cadenceDays ?? null,
    nextRunAt: state?.nextRunAt.toISOString() ?? null,
    lastRunAt: state?.lastRunAt?.toISOString() ?? null,
    lastSuccessAt: state?.lastSuccessAt?.toISOString() ?? null,
    lastFailureAt: state?.lastFailureAt?.toISOString() ?? null,
    lastFailureCode: state?.lastFailureCode ?? null,
    latestRun: latestRun
      ? {
          ...latestRun,
          status: latestRun.status,
          scheduledFor: latestRun.scheduledFor.toISOString(),
          completedAt: latestRun.completedAt?.toISOString() ?? null,
        }
      : null,
    suggestions: suggestions.map((suggestion) => ({
      ...suggestion,
      evidence: suggestion.evidence as SourceEvidence[],
      createdAt: suggestion.createdAt.toISOString(),
    })),
  };
}

export async function reviewSourceMonitoringSuggestion(input: {
  siteId: string;
  suggestionId: string;
  actor: { id: string; email: string; role: "owner" | "operator" };
  action: "accept" | "reject";
  editedValue?: unknown;
  note?: string;
  expectedRevision?: number;
}): Promise<{
  status: "ACCEPTED" | "REJECTED";
  revision?: number;
  draft?: unknown;
  vertical?: Vertical;
}> {
  const db = getDb();
  return db.$transaction(
    async (transaction) => {
      const suggestion = await transaction.sourceMonitorSuggestion.findFirst({
        where: {
          id: input.suggestionId,
          siteId: input.siteId,
          status: "PENDING",
        },
      });
      if (!suggestion) throw new Error("Suggestion not found");
      const reviewedAt = new Date();
      if (input.action === "reject") {
        await transaction.sourceMonitorSuggestion.update({
          where: { id: suggestion.id },
          data: {
            status: "REJECTED",
            reviewedAt,
            reviewedBy: input.actor.id,
            reviewNote: input.note?.trim().slice(0, 500) || null,
          },
        });
        await createReviewAudit(
          transaction,
          suggestion,
          input,
          "REJECTED",
          false,
        );
        return { status: "REJECTED" };
      }

      const site = await transaction.site.findUnique({
        where: { id: input.siteId },
        include: siteDraftRelations,
      });
      if (!site) throw new Error("Site not found");
      if (
        input.expectedRevision === undefined ||
        site.draftRevision !== input.expectedRevision
      ) {
        throw new DraftRevisionConflictError(site.draftRevision);
      }
      const loaded = projectSiteDraft(site);
      const currentDraft = loaded.draft as PersistableSiteDraft;
      const currentValue = monitoringFieldValue(currentDraft, suggestion.field);
      if (!sameJsonValue(currentValue, suggestion.currentValue)) {
        throw new SourceMonitoringConflictError();
      }
      const proposedValue = parseSourceMonitoringSuggestionValue(
        suggestion.field,
        input.editedValue ?? suggestion.suggestedValue,
        currentDraft,
        site.vertical,
      );
      const revision = await applySuggestionValue(
        transaction,
        site.id,
        site.vertical,
        suggestion.field,
        proposedValue,
      );
      await transaction.sourceMonitorSuggestion.update({
        where: { id: suggestion.id },
        data: {
          status: "ACCEPTED",
          editedValue:
            input.editedValue === undefined
              ? undefined
              : (proposedValue as Prisma.InputJsonValue),
          reviewedAt,
          reviewedBy: input.actor.id,
          reviewNote: input.note?.trim().slice(0, 500) || null,
        },
      });
      await createReviewAudit(
        transaction,
        suggestion,
        input,
        "ACCEPTED",
        input.editedValue !== undefined,
      );
      const accepted = await transaction.site.findUniqueOrThrow({
        where: { id: site.id },
        include: siteDraftRelations,
      });
      const projectedAccepted = projectSiteDraft(accepted);
      return {
        status: "ACCEPTED",
        revision,
        draft: projectedAccepted.draft,
        vertical: accepted.vertical,
      };
    },
    { isolationLevel: "Serializable" },
  );
}

async function persistSuccessfulRun(
  context: { runId: string; siteId: string },
  suggestions: MonitoringSuggestionInput[],
  checkedSourceCount: number,
  failedSourceCount: number,
) {
  const now = new Date();
  await getDb().$transaction(
    async (transaction) => {
      const moved = await transaction.sourceMonitorRun.updateMany({
        where: { id: context.runId, siteId: context.siteId, status: "RUNNING" },
        data: {
          status: "SUCCEEDED",
          completedAt: now,
          errorCode: null,
          checkedSourceCount,
          failedSourceCount,
          suggestionCount: suggestions.length,
        },
      });
      if (moved.count === 0) return;
      if (suggestions.length > 0) {
        await transaction.sourceMonitorSuggestion.createMany({
          data: suggestions.map((suggestion) => ({
            ...suggestion,
            siteId: context.siteId,
            runId: context.runId,
            evidence: suggestion.evidence as unknown as Prisma.InputJsonValue,
          })),
          skipDuplicates: true,
        });
        await transaction.auditEvent.create({
          data: {
            type: "source_monitoring.review_required",
            actor: "system:source-monitor",
            siteId: context.siteId,
            metadata: {
              runId: context.runId,
              suggestionCount: suggestions.length,
              fields: [...new Set(suggestions.map((item) => item.field))],
            },
          },
        });
      }
      await transaction.sourceMonitorState.updateMany({
        where: { siteId: context.siteId },
        data: {
          lastSuccessAt: now,
          lastFailureCode: null,
        },
      });
    },
    { isolationLevel: "Serializable" },
  );
}

async function applySuggestionValue(
  transaction: Prisma.TransactionClient,
  siteId: string,
  vertical: Vertical,
  field: SourceMonitorSuggestionField,
  value: unknown,
): Promise<number> {
  if (field === "CONTACT") {
    const contact = contactSchema.parse(value);
    const updated = await transaction.site.update({
      where: { id: siteId },
      data: { ...contact, draftRevision: { increment: 1 } },
      select: { draftRevision: true },
    });
    return updated.draftRevision;
  }
  if (field === "HOURS") {
    const updated = await transaction.site.update({
      where: { id: siteId },
      data: {
        businessHours: businessHoursSchema.parse(
          value,
        ) as Prisma.InputJsonValue,
        draftRevision: { increment: 1 },
      },
      select: { draftRevision: true },
    });
    return updated.draftRevision;
  }
  if (field === "LINKS") {
    const { integrations: links, translations } =
      linksSuggestionSchema.parse(value);
    const updated = await transaction.site.update({
      where: { id: siteId },
      data: {
        translations: translations as Prisma.InputJsonValue,
        draftRevision: { increment: 1 },
      },
      select: { draftRevision: true },
    });
    await transaction.integration.deleteMany({ where: { siteId } });
    await transaction.integration.createMany({
      data: links.map((link, position) => ({
        siteId,
        type: integrationType(link.type),
        label: link.label,
        provider: link.provider,
        url: link.url,
        enabled: link.enabled,
        venueId: link.venueId,
        position,
      })),
    });
    return updated.draftRevision;
  }

  const config = resolveVerticalConfig(vertical);
  const { catalogSections: sections, translations } =
    menuSuggestionSchema.parse(value);
  const updated = await transaction.site.update({
    where: { id: siteId },
    data: {
      translations: translations as Prisma.InputJsonValue,
      draftRevision: { increment: 1 },
    },
    select: { draftRevision: true },
  });
  await transaction.catalogSection.deleteMany({ where: { siteId } });
  for (const [position, section] of sections.entries()) {
    await transaction.catalogSection.create({
      data: {
        siteId,
        name: section.name,
        description: section.description,
        position,
        items: {
          create: section.items.map((item, itemPosition) => ({
            name: item.name,
            description: item.description,
            price: item.price,
            currency: item.currency,
            available: item.available,
            attributes: config.itemAttributesSchema.parse(
              item.attributes,
            ) as Prisma.InputJsonValue,
            imageUrl: item.imageUrl,
            originalImageUrl: item.originalImageUrl,
            imageProvenance: imageProvenance(item.imageProvenance),
            position: itemPosition,
          })),
        },
      },
    });
  }
  return updated.draftRevision;
}

function integrationType(value: string): IntegrationType {
  return value.toUpperCase() as IntegrationType;
}

function imageProvenance(value: string | null | undefined) {
  if (!value) return null;
  return value.replaceAll("-", "_").toUpperCase() as
    "OFFICIAL" | "OWNER" | "PERMISSIONED_UGC";
}

async function createReviewAudit(
  transaction: Prisma.TransactionClient,
  suggestion: {
    id: string;
    runId: string;
    field: SourceMonitorSuggestionField;
  },
  input: {
    siteId: string;
    actor: { id: string; email: string; role: "owner" | "operator" };
    note?: string;
  },
  status: "ACCEPTED" | "REJECTED",
  edited: boolean,
) {
  await transaction.auditEvent.create({
    data: {
      type: `source_monitoring.suggestion_${status.toLowerCase()}`,
      actor: input.actor.id,
      siteId: input.siteId,
      metadata: {
        suggestionId: suggestion.id,
        runId: suggestion.runId,
        field: suggestion.field,
        reviewerEmail: input.actor.email,
        reviewerRole: input.actor.role,
        edited,
      },
    },
  });
}

async function startMonitoringWorkflow(runId: string): Promise<string> {
  const [{ start }, { sourceMonitoringWorkflow }] = await Promise.all([
    import("workflow/api"),
    import("@/workflows/source-monitoring"),
  ]);
  return (await start(sourceMonitoringWorkflow, [runId])).runId;
}

function safeMonitoringErrorCode(error: unknown) {
  if (
    error instanceof Error &&
    /resolve|network|fetch|HTTP|redirect|website/i.test(error.message)
  ) {
    return "SOURCE_FETCH_FAILED";
  }
  if (error instanceof z.ZodError) return "SOURCE_PARSE_FAILED";
  return "MONITORING_FAILED";
}

function sourceMonitoringEmailHtml(input: {
  siteName: string;
  count: number;
  reviewUrl: string;
}) {
  return `<div style="font-family:Arial,sans-serif;background:#f4efe5;padding:40px"><div style="max-width:520px;margin:0 auto;background:#fffdf8;border-radius:16px;padding:32px"><h1 style="margin:0 0 16px;font-size:22px;color:#2f2a24">Source updates need review</h1><p style="font-size:15px;color:#5c5147">${input.count} evidence-backed update${input.count === 1 ? "" : "s"} were found for ${escapeHtml(input.siteName)}. Nothing has been applied or published.</p><p style="margin-top:24px"><a href="${escapeHtml(input.reviewUrl)}" style="color:#a5482d;font-weight:bold">Review suggestions</a></p></div></div>`;
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export const SOURCE_MONITORING_SCHEDULER_INTERVAL_MS = DAY_MS;
