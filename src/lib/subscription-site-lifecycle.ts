import type { Prisma } from "@/generated/prisma/client";
import type { SubscriptionStatus } from "@/generated/prisma/enums";
import { siteStatusForDomainState } from "@/lib/domain-routing";

export async function reconcileSiteSubscriptionLifecycle(
  tx: Prisma.TransactionClient,
  input: {
    siteId: string;
    subscriptionStatus: SubscriptionStatus;
    stripeEventId: string;
  },
): Promise<void> {
  const site = await tx.site.findUnique({
    where: { id: input.siteId },
    select: {
      status: true,
      publishedSiteVersionId: true,
      publishedSiteVersion: {
        select: { id: true, siteId: true, publishedAt: true },
      },
    },
  });
  if (!site) return;

  let nextStatus = site.status;
  if (
    input.subscriptionStatus === "PAST_DUE" ||
    input.subscriptionStatus === "CANCELED"
  ) {
    if (
      site.status === "CLAIMED" ||
      site.status === "LIVE" ||
      site.status === "PAUSED"
    ) {
      nextStatus = "PAUSED";
    }
  } else if (input.subscriptionStatus === "ACTIVE") {
    if (
      site.status === "CLAIMED" ||
      site.status === "LIVE" ||
      site.status === "PAUSED"
    ) {
      const verifiedDomainCount = await tx.domain.count({
        where: { siteId: input.siteId, verified: true },
      });
      const published = site.publishedSiteVersion;
      nextStatus = siteStatusForDomainState({
        currentStatus: site.status === "PAUSED" ? "CLAIMED" : site.status,
        hasVerifiedDomain: verifiedDomainCount > 0,
        hasValidPublishedVersion:
          Boolean(site.publishedSiteVersionId) &&
          published?.id === site.publishedSiteVersionId &&
          published.siteId === input.siteId &&
          published.publishedAt instanceof Date,
      });
    }
  }
  // Any other status — notably INCOMPLETE, the pre-first-payment state —
  // deliberately leaves an already-provisioned site untouched.

  if (nextStatus === site.status) return;
  await tx.site.update({
    where: { id: input.siteId },
    data: { status: nextStatus },
  });
  await tx.auditEvent.create({
    data: {
      type:
        nextStatus === "PAUSED"
          ? "billing.site.paused"
          : "billing.site.restored",
      actor: "stripe-webhook",
      siteId: input.siteId,
      metadata: {
        stripeEventId: input.stripeEventId,
        subscriptionStatus: input.subscriptionStatus,
        previousStatus: site.status,
        nextStatus,
        ...(nextStatus === "PAUSED" ? {} : { restoredTo: nextStatus }),
      },
    },
  });
}
