import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, mock, test } from "bun:test";
import { verifyOutreachInboundForwardPredecessorUpgrade } from "@/lib/outreach-inbound-forward-migration.postgres.test";

const enabled = process.env.OUTREACH_INBOUND_RACE_POSTGRES_TEST === "1";
process.env.OUTREACH_LEGAL_CONTROLLER = "Corner Shop Labs Ltd";
process.env.NEXT_PUBLIC_APP_URL = "https://cornershop.dev";

const suffix = randomUUID();
const safeSuffix = suffix.replaceAll("-", "");
const siteId = `inbound-race-site-${suffix}`;
const slug = `inbound-race-${suffix}`;
const recipient = `owner@${slug}.example.test`;
const inboundProviderId = `inbound-race-recv-${suffix}`;
const initialMessageId = `inbound-race-initial-${suffix}`;
const dispatchId = `inbound-race-dispatch-${suffix}`;
const invitationId = `inbound-race-invitation-${suffix}`;
const triggerName = `inbound_race_trigger_${safeSuffix}`;
const triggerFunction = `inbound_race_function_${safeSuffix}`;
const blockerClassId = 1_381_258_069;
const blockerObjectId = Number.parseInt(safeSuffix.slice(0, 7), 16);
const forwardEventRaceSourceId = `forward-event-race-source-${suffix}`;
const forwardEventRaceForwardId = `forward-event-race-${suffix}`;
const forwardEventRaceTriggerName = `forward_event_race_trigger_${safeSuffix}`;
const forwardEventRaceTriggerFunction = `forward_event_race_function_${safeSuffix}`;
const forwardEventRaceBlockerClassId = 1_381_258_070;
const forwardEventRaceBlockerObjectId = Number.parseInt(
  safeSuffix.slice(7, 14),
  16,
);
const sentIdentitySourceId = `sent-identity-source-${suffix}`;
const sentIdentityForwardId = `sent-identity-forward-${suffix}`;
const acceptanceRaceSourceId = `acceptance-race-source-${suffix}`;
const acceptanceRaceForwardId = `acceptance-race-forward-${suffix}`;
const acceptanceRaceTriggerName = `acceptance_race_trigger_${safeSuffix}`;
const acceptanceRaceTriggerFunction = `acceptance_race_function_${safeSuffix}`;
const acceptanceRaceBlockerClassId = 1_381_258_071;
const acceptanceRaceBlockerObjectId = Number.parseInt(
  safeSuffix.slice(14, 21),
  16,
);
const failureReceiptRaceSourceId = `failure-receipt-race-source-${suffix}`;
const failureReceiptRaceForwardId = `failure-receipt-race-forward-${suffix}`;
const lateReceiptSourceId = `late-receipt-source-${suffix}`;
const lateReceiptForwardId = `late-receipt-forward-${suffix}`;
const configOnlySourceId = `config-only-source-${suffix}`;
const configOnlyForwardId = `config-only-forward-${suffix}`;
const configPreboundSourceId = `config-prebound-source-${suffix}`;
const configPreboundForwardId = `config-prebound-forward-${suffix}`;
const configMissingFirstSourceId = `config-missing-first-source-${suffix}`;
const configMissingFirstForwardId = `config-missing-first-forward-${suffix}`;
let beforeForwardProviderReturn: (() => void | Promise<void>) | null = null;
let forwardProviderResult: {
  data: { id: string } | null;
  error: {
    message: string;
    statusCode: number | null;
    name: string | null;
  } | null;
} = {
  data: { id: "must-not-send" },
  error: null,
};
const providerSend = mock(async () => {
  await beforeForwardProviderReturn?.();
  return forwardProviderResult;
});

if (enabled) {
  mock.module("server-only", () => ({}));
  mock.module("@/lib/resend", () => ({
    getResend: () => ({ emails: { send: providerSend } }),
    sendBoundedResendEmail: providerSend,
    emailSender: () =>
      "Vincent from Restofrontapp <vincent@send.restofront.com>",
    emailReplyTo: () => "vincent@reply.restofront.com",
  }));
  mock.module("@/lib/resend-receiving", () => ({
    fetchReceivedResendEmail: async () => ({
      id: inboundProviderId,
      from: recipient,
      to: ["vincent@reply.restofront.com"],
      subject: "Re: preview",
      text: "Please stop the follow-up.",
      html: null,
      messageId: `<reply-${safeSuffix}@example.test>`,
      receivedFor: ["vincent@reply.restofront.com"],
      headers: {
        "in-reply-to": `<initial-${safeSuffix}@send.restofront.com>`,
        references: `<initial-${safeSuffix}@send.restofront.com>`,
      },
    }),
  }));
  mock.module("@/lib/operator-alerts", () => ({
    captureOperatorAlert: async () => "delivered" as const,
  }));
}

let db: ReturnType<typeof import("@/lib/db").getDb>;
let recordInbound: typeof import("@/lib/outreach-inbound").recordInboundOutreachMessage;
let recordForwardEvent: typeof import("@/lib/outreach-inbound-forward-event-recorder").recordResendInboundForwardEvent;
let deliverForward: typeof import("@/lib/outreach-inbound-forward").deliverOutreachInboundForward;
let sendLeadEmail: typeof import("@/lib/outreach").sendLeadEmail;

describe.skipIf(!enabled)("PostgreSQL inbound suppression race", () => {
  beforeAll(async () => {
    const database = await import("@/lib/db");
    ({ recordInboundOutreachMessage: recordInbound } =
      await import("@/lib/outreach-inbound"));
    ({ recordResendInboundForwardEvent: recordForwardEvent } =
      await import("@/lib/outreach-inbound-forward-event-recorder"));
    ({ deliverOutreachInboundForward: deliverForward } =
      await import("@/lib/outreach-inbound-forward"));
    ({ sendLeadEmail } = await import("@/lib/outreach"));
    db = database.getDb();

    const site = await db.site.create({
      data: {
        id: siteId,
        slug,
        name: "Inbound race fixture",
        leadContactEmail: recipient,
        sourceUrl: `https://${slug}.example.test/`,
        vertical: "RESTAURANT",
        status: "PREVIEW_READY",
        attributes: {
          leadEligibility: {
            state: "ELIGIBLE",
            evidence: {
              channel_basis: "VERIFIED_WRITTEN_CONSENT",
              recipient,
              controller: "Corner Shop Labs Ltd",
              channel: "EMAIL",
              purpose: "CLAIM_INVITATION_AND_FOLLOW_UP",
              evidence_timestamp: new Date(Date.now() - 60_000).toISOString(),
              evidence_source: `consent:inbound-race-${safeSuffix}`,
            },
            updatedAt: new Date().toISOString(),
            updatedBy: "operator:fixture",
          },
        },
      },
    });
    const review = await db.auditEvent.create({
      data: {
        siteId,
        type: "site.review.completed",
        actor: "operator:fixture",
      },
    });
    await db.outreachMessage.create({
      data: {
        id: initialMessageId,
        idempotencyKey: `lead-outreach:${siteId}:preview_ready`,
        siteId,
        direction: "OUTBOUND",
        providerMessageId: `initial-provider-${suffix}`,
        rfcMessageId: `initial-${safeSuffix}@send.restofront.com`,
        fromAddress: "vincent@send.restofront.com",
        replyToAddress: "vincent@reply.restofront.com",
        toAddress: recipient,
        subject: "Preview ready",
        textBody: "Preview ready",
        template: "preview_ready",
        threadKey: `lead:${siteId}`,
        status: "SENT",
        sentAt: new Date(),
      },
    });
    await db.outreachDispatch.create({
      data: {
        id: dispatchId,
        idempotencyKey: `lead-outreach:${siteId}:preview_ready`,
        siteId,
        template: "preview_ready",
        recipient,
        reviewedAt: review.createdAt,
        status: "SENT",
        requestedBy: "operator:fixture",
      },
    });
    await db.claimInvitation.create({
      data: {
        id: invitationId,
        email: recipient,
        tokenHash: safeSuffix.padEnd(64, "0").slice(0, 64),
        outreachKey: `lead-outreach:${siteId}:follow_up_1`,
        proofMethod: "OPERATOR_APPROVAL",
        approvalEvidenceRef: `outreach-dispatch:${dispatchId}`,
        approvedBy: "operator:fixture",
        approvedAt: new Date(),
        expiresAt: new Date(Date.now() + 60_000),
        siteId,
      },
    });

    await db.$executeRawUnsafe(`
      CREATE FUNCTION "${triggerFunction}"() RETURNS trigger AS $race$
      BEGIN
        IF NEW."providerMessageId" = '${inboundProviderId}' THEN
          PERFORM pg_advisory_xact_lock(${blockerClassId}, ${blockerObjectId});
        END IF;
        RETURN NEW;
      END
      $race$ LANGUAGE plpgsql
    `);
    await db.$executeRawUnsafe(`
      CREATE TRIGGER "${triggerName}"
      BEFORE INSERT ON "OutreachMessage"
      FOR EACH ROW EXECUTE FUNCTION "${triggerFunction}"()
    `);
    await db.$executeRawUnsafe(`
      CREATE FUNCTION "${forwardEventRaceTriggerFunction}"() RETURNS trigger AS $race$
      BEGIN
        IF NEW."forwardId" = '${forwardEventRaceForwardId}' THEN
          PERFORM pg_advisory_xact_lock(${forwardEventRaceBlockerClassId}, ${forwardEventRaceBlockerObjectId});
        END IF;
        RETURN NEW;
      END
      $race$ LANGUAGE plpgsql
    `);
    await db.$executeRawUnsafe(`
      CREATE TRIGGER "${forwardEventRaceTriggerName}"
      BEFORE INSERT ON "OutreachForwardProviderEvent"
      FOR EACH ROW EXECUTE FUNCTION "${forwardEventRaceTriggerFunction}"()
    `);
    await db.$executeRawUnsafe(`
      CREATE FUNCTION "${acceptanceRaceTriggerFunction}"() RETURNS trigger AS $race$
      BEGIN
        IF NEW."id" IN ('${acceptanceRaceForwardId}', '${failureReceiptRaceForwardId}')
          AND NEW."status" = 'SENT'
          AND NEW."sentAt" IS NOT NULL
          AND (
            OLD."status" IS DISTINCT FROM NEW."status"
            OR OLD."sentAt" IS DISTINCT FROM NEW."sentAt"
          )
        THEN
          PERFORM pg_advisory_xact_lock(${acceptanceRaceBlockerClassId}, ${acceptanceRaceBlockerObjectId});
        END IF;
        RETURN NEW;
      END
      $race$ LANGUAGE plpgsql
    `);
    await db.$executeRawUnsafe(`
      CREATE TRIGGER "${acceptanceRaceTriggerName}"
      AFTER UPDATE ON "OutreachInboundForward"
      FOR EACH ROW EXECUTE FUNCTION "${acceptanceRaceTriggerFunction}"()
    `);
    void site;
  });

  afterAll(async () => {
    if (!db) return;
    await db.$executeRawUnsafe(
      `DROP TRIGGER IF EXISTS "${triggerName}" ON "OutreachMessage"`,
    );
    await db.$executeRawUnsafe(
      `DROP FUNCTION IF EXISTS "${triggerFunction}"()`,
    );
    await db.$executeRawUnsafe(
      `DROP TRIGGER IF EXISTS "${forwardEventRaceTriggerName}" ON "OutreachForwardProviderEvent"`,
    );
    await db.$executeRawUnsafe(
      `DROP FUNCTION IF EXISTS "${forwardEventRaceTriggerFunction}"()`,
    );
    await db.$executeRawUnsafe(
      `DROP TRIGGER IF EXISTS "${acceptanceRaceTriggerName}" ON "OutreachInboundForward"`,
    );
    await db.$executeRawUnsafe(
      `DROP FUNCTION IF EXISTS "${acceptanceRaceTriggerFunction}"()`,
    );
    await db.$executeRaw`
      DELETE FROM "OperatorAlert"
      WHERE "context"->>'forwardId' IN (
        ${forwardEventRaceForwardId},
        ${sentIdentityForwardId},
        ${acceptanceRaceForwardId},
        ${failureReceiptRaceForwardId},
        ${lateReceiptForwardId},
        ${configOnlyForwardId},
        ${configPreboundForwardId},
        ${configMissingFirstForwardId}
      )
    `;
    await db.site.deleteMany({ where: { id: siteId } });
  });

  test(
    "upgrades the exact forwarding predecessor on a scratch database",
    verifyOutreachInboundForwardPredecessorUpgrade,
    120_000,
  );

  test("an inbound reply that owns the fence suppresses a racing follow-up", async () => {
    let releaseBlocker!: () => void;
    let blockerReady!: () => void;
    const release = new Promise<void>((resolve) => {
      releaseBlocker = resolve;
    });
    const ready = new Promise<void>((resolve) => {
      blockerReady = resolve;
    });
    const blocker = db.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`
        DO $blocker$
        BEGIN
          PERFORM pg_advisory_xact_lock(${blockerClassId}, ${blockerObjectId});
        END
        $blocker$
      `);
      blockerReady();
      await release;
    });
    await ready;

    const inbound = recordInbound({
      eventId: `inbound-race-event-${suffix}`,
      occurredAt: new Date(),
      metadata: {
        emailId: inboundProviderId,
        from: recipient,
        to: ["vincent@reply.restofront.com"],
        subject: "Re: preview",
        rfcMessageId: `<reply-${safeSuffix}@example.test>`,
        receivedFor: ["vincent@reply.restofront.com"],
      },
    });
    await waitForAdvisoryWaiter();

    const review = await db.auditEvent.findFirstOrThrow({
      where: { siteId, type: "site.review.completed" },
      orderBy: { createdAt: "desc" },
    });
    const followUp = sendLeadEmail({
      siteId,
      template: "follow_up_1",
      claimUrl: `https://cornershop.dev/claim/${slug}#claim_token=test`,
      to: recipient,
      actor: "operator:fixture",
      expectedReviewedAt: review.createdAt.toISOString(),
      claimInvitationId: invitationId,
      dispatchAuthorization: { dispatchId, attempt: 1 },
    });

    releaseBlocker();
    await blocker;
    await expect(inbound).resolves.toMatchObject({
      handled: true,
      created: true,
      siteId,
    });
    await expect(followUp).rejects.toThrow("already replied");
    expect(providerSend).not.toHaveBeenCalled();
  });

  test("provider ids are unique across inbound forwards", async () => {
    const sourceIds = [
      `inbound-forward-source-a-${suffix}`,
      `inbound-forward-source-b-${suffix}`,
    ];
    await db.outreachMessage.createMany({
      data: sourceIds.map((id, index) => ({
        id,
        idempotencyKey: `inbound-forward-source:${id}`,
        siteId,
        direction: "INBOUND" as const,
        providerMessageId: `inbound-forward-source-provider-${index}-${suffix}`,
        fromAddress: `owner-${index}@${slug}.example.test`,
        toAddress: "vincent@reply.restofront.com",
        subject: "Re: preview",
        textBody: "Provider uniqueness fixture.",
        status: "RECEIVED" as const,
        receivedAt: new Date(),
      })),
    });
    const forwardIds = [
      `inbound-forward-a-${suffix}`,
      `inbound-forward-b-${suffix}`,
    ];
    for (const [index, id] of forwardIds.entries()) {
      await db.outreachInboundForward.create({
        data: {
          id,
          outreachMessageId: sourceIds[index]!,
          idempotencyKey: `outreach-inbound-forward:${sourceIds[index]}`,
          targetAddress: "operator@example.test",
          senderAddress: "Cornershopdev <vincent@send.cornershop.dev>",
          siteName: "Provider uniqueness fixture",
          siteSlug: slug,
        },
      });
    }

    const sharedProviderId = `inbound-forward-shared-${suffix}`;
    await db.outreachInboundForward.update({
      where: { id: forwardIds[0] },
      data: { providerMessageId: sharedProviderId },
    });
    let conflict: unknown;
    try {
      await db.outreachInboundForward.update({
        where: { id: forwardIds[1] },
        data: { providerMessageId: sharedProviderId },
      });
    } catch (error) {
      conflict = error;
    }
    expect(conflict).toMatchObject({ code: "P2002" });

    expect(
      await db.outreachInboundForward.count({
        where: { providerMessageId: sharedProviderId },
      }),
    ).toBe(1);
  });

  test("racing receipt identities bind once and durably alert the loser", async () => {
    await db.outreachMessage.create({
      data: {
        id: forwardEventRaceSourceId,
        idempotencyKey: `inbound-forward-source:${forwardEventRaceSourceId}`,
        siteId,
        direction: "INBOUND",
        providerMessageId: `forward-event-source-provider-${suffix}`,
        fromAddress: `forward-event-owner@${slug}.example.test`,
        toAddress: "vincent@reply.restofront.com",
        subject: "Re: preview",
        textBody: "Provider event race fixture.",
        status: "RECEIVED",
        receivedAt: new Date(),
      },
    });
    await db.outreachInboundForward.create({
      data: {
        id: forwardEventRaceForwardId,
        outreachMessageId: forwardEventRaceSourceId,
        idempotencyKey: `outreach-inbound-forward:${forwardEventRaceSourceId}`,
        targetAddress: "operator@example.test",
        senderAddress: "Cornershopdev <vincent@send.cornershop.dev>",
        siteName: "Provider event race fixture",
        siteSlug: slug,
        attempts: 1,
        firstProviderAttemptAt: new Date(Date.now() - 60_000),
      },
    });

    let releaseBlocker!: () => void;
    let blockerReady!: () => void;
    const release = new Promise<void>((resolve) => {
      releaseBlocker = resolve;
    });
    const ready = new Promise<void>((resolve) => {
      blockerReady = resolve;
    });
    const blocker = db.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`
        DO $blocker$
        BEGIN
          PERFORM pg_advisory_xact_lock(${forwardEventRaceBlockerClassId}, ${forwardEventRaceBlockerObjectId});
        END
        $blocker$
      `);
      blockerReady();
      await release;
    });
    await ready;

    const occurredAt = new Date("2026-08-23T10:03:00.000Z");
    const receipts = ["a", "b"].map((identity) =>
      recordForwardEvent({
        eventId: `forward-event-race-webhook-${identity}-${suffix}`,
        eventType: "email.delivered",
        occurredAt,
        providerMessageId: `forward-event-race-provider-${identity}-${suffix}`,
        taggedInboundForwardId: forwardEventRaceForwardId,
      }),
    );
    await waitForAdvisoryWaiters(
      forwardEventRaceBlockerClassId,
      forwardEventRaceBlockerObjectId,
      2,
    );
    releaseBlocker();
    await blocker;
    const results = await Promise.all(receipts);

    expect(results.filter((result) => result.updated === 1)).toHaveLength(1);
    expect(results.filter((result) => result.reason === "identity_conflict"))
      .toHaveLength(1);
    const forward = await db.outreachInboundForward.findUniqueOrThrow({
      where: { id: forwardEventRaceForwardId },
      select: { providerMessageId: true, deliveryStatus: true },
    });
    expect(forward.providerMessageId).toMatch(
      /^forward-event-race-provider-[ab]-/,
    );
    expect(forward.deliveryStatus).toBe("DELIVERED");
    expect(
      await db.outreachForwardProviderEvent.count({
        where: { forwardId: forwardEventRaceForwardId },
      }),
    ).toBe(2);
    const alerts = await db.operatorAlert.findMany({
      where: { kind: "OUTREACH_SEND_FAILURE" },
      select: { context: true },
    });
    expect(
      alerts.filter(
        ({ context }) =>
          typeof context === "object" &&
          context !== null &&
          !Array.isArray(context) &&
          context.forwardId === forwardEventRaceForwardId &&
          context.failureCode === "provider_identity_conflict",
      ),
    ).toHaveLength(1);
  });

  test("a SENT identity conflict with a NULL failure code persists its alert", async () => {
    await db.outreachMessage.create({
      data: {
        id: sentIdentitySourceId,
        idempotencyKey: `inbound-forward-source:${sentIdentitySourceId}`,
        siteId,
        direction: "INBOUND",
        providerMessageId: `sent-identity-source-provider-${suffix}`,
        fromAddress: `sent-identity-owner@${slug}.example.test`,
        toAddress: "vincent@reply.restofront.com",
        subject: "Re: preview",
        textBody: "SENT identity fixture.",
        status: "RECEIVED",
        receivedAt: new Date(),
      },
    });
    await db.outreachInboundForward.create({
      data: {
        id: sentIdentityForwardId,
        outreachMessageId: sentIdentitySourceId,
        idempotencyKey: `outreach-inbound-forward:${sentIdentitySourceId}`,
        targetAddress: "operator@example.test",
        senderAddress: "Cornershopdev <vincent@send.cornershop.dev>",
        siteName: "SENT identity fixture",
        siteSlug: slug,
      },
    });
    const receiptProviderId = `sent-identity-receipt-${suffix}`;
    const responseProviderId = `sent-identity-response-${suffix}`;
    forwardProviderResult = {
      data: { id: responseProviderId },
      error: null,
    };
    beforeForwardProviderReturn = async () => {
      await db.outreachInboundForward.update({
        where: { id: sentIdentityForwardId },
        data: {
          status: "SENT",
          providerMessageId: receiptProviderId,
          deliveryStatus: "DELIVERED",
          lastFailureCode: null,
        },
      });
    };
    providerSend.mockClear();

    try {
      expect(
        await deliverForward(sentIdentityForwardId, {
          EMAIL_FROM: "Cornershopdev <vincent@send.cornershop.dev>",
          EMAIL_REPLY_TO: "vincent@reply.cornershop.dev",
          OUTREACH_INBOUND_FORWARD_TO: "operator@example.test",
        }),
      ).toBe("exhausted");
    } finally {
      beforeForwardProviderReturn = null;
      forwardProviderResult = {
        data: { id: "must-not-send" },
        error: null,
      };
    }

    expect(providerSend).toHaveBeenCalledTimes(1);
    expect(
      await db.outreachInboundForward.findUniqueOrThrow({
        where: { id: sentIdentityForwardId },
        select: {
          status: true,
          providerMessageId: true,
          lastFailureCode: true,
          deliveryLeaseToken: true,
        },
      }),
    ).toEqual({
      status: "SENT",
      providerMessageId: receiptProviderId,
      lastFailureCode: null,
      deliveryLeaseToken: null,
    });
    const alerts = await db.operatorAlert.findMany({
      where: { kind: "OUTREACH_SEND_FAILURE" },
      select: { context: true },
    });
    expect(
      alerts.filter(
        ({ context }) =>
          typeof context === "object" &&
          context !== null &&
          !Array.isArray(context) &&
          context.forwardId === sentIdentityForwardId &&
          context.failureCode === "provider_identity_conflict",
      ),
    ).toHaveLength(1);
  });

  test("a positive receipt committing before exhaustion wins the atomic fence", async () => {
    await createForwardFixture(acceptanceRaceSourceId, acceptanceRaceForwardId);

    let releaseBlocker!: () => void;
    let blockerReady!: () => void;
    let releaseProvider!: () => void;
    let providerWaiting!: () => void;
    const blockerRelease = new Promise<void>((resolve) => {
      releaseBlocker = resolve;
    });
    const blockerStarted = new Promise<void>((resolve) => {
      blockerReady = resolve;
    });
    const providerRelease = new Promise<void>((resolve) => {
      releaseProvider = resolve;
    });
    const providerStarted = new Promise<void>((resolve) => {
      providerWaiting = resolve;
    });
    const blocker = db.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`
        DO $blocker$
        BEGIN
          PERFORM pg_advisory_xact_lock(${acceptanceRaceBlockerClassId}, ${acceptanceRaceBlockerObjectId});
        END
        $blocker$
      `);
      blockerReady();
      await blockerRelease;
    });
    await blockerStarted;

    forwardProviderResult = {
      data: null,
      error: {
        message: "fixture rejection",
        statusCode: 503,
        name: "internal_server_error",
      },
    };
    beforeForwardProviderReturn = async () => {
      providerWaiting();
      await providerRelease;
    };
    providerSend.mockClear();
    const deliveredAt = new Date("2026-08-23T10:20:00.000Z");
    let delivery: Promise<unknown> | null = null;
    let receipt: Promise<unknown> | null = null;

    try {
      delivery = deliverForward(acceptanceRaceForwardId, forwardEnvironment());
      await providerStarted;
      receipt = recordForwardEvent({
        eventId: `acceptance-race-delivered-${suffix}`,
        eventType: "email.delivered",
        occurredAt: deliveredAt,
        providerMessageId: `acceptance-race-provider-${suffix}`,
        taggedInboundForwardId: acceptanceRaceForwardId,
      });
      await waitForAdvisoryWaiters(
        acceptanceRaceBlockerClassId,
        acceptanceRaceBlockerObjectId,
        1,
      );

      releaseProvider();
      await waitForForwardTransactionWaiter();
      releaseBlocker();

      await expect(receipt).resolves.toEqual({ handled: true, updated: 1 });
      await expect(delivery).resolves.toBe("deduplicated");
      await blocker;
    } finally {
      releaseProvider();
      releaseBlocker();
      beforeForwardProviderReturn = null;
      forwardProviderResult = {
        data: { id: "must-not-send" },
        error: null,
      };
      await Promise.allSettled(
        [blocker, delivery, receipt].filter(
          (promise): promise is Promise<unknown> => promise !== null,
        ),
      );
    }

    expect(providerSend).toHaveBeenCalledTimes(1);
    expect(
      await db.outreachInboundForward.findUniqueOrThrow({
        where: { id: acceptanceRaceForwardId },
        select: {
          status: true,
          deliveryStatus: true,
          providerMessageId: true,
          sentAt: true,
          providerEventAt: true,
          lastFailureCode: true,
          deliveryLeaseToken: true,
          deliveryLeaseUntil: true,
        },
      }),
    ).toEqual({
      status: "SENT",
      deliveryStatus: "DELIVERED",
      providerMessageId: `acceptance-race-provider-${suffix}`,
      sentAt: deliveredAt,
      providerEventAt: deliveredAt,
      lastFailureCode: null,
      deliveryLeaseToken: null,
      deliveryLeaseUntil: null,
    });
    expect(
      await db.outreachForwardProviderEvent.count({
        where: { forwardId: acceptanceRaceForwardId },
      }),
    ).toBe(1);
    expect(await exhaustionAlertCount(acceptanceRaceForwardId)).toBe(0);

    expect(
      await deliverForward(acceptanceRaceForwardId, forwardEnvironment()),
    ).toBe("deduplicated");
    expect(providerSend).toHaveBeenCalledTimes(1);
  });

  test("a failure receipt committing before exhaustion settles the outbox and only alerts delivery", async () => {
    await createForwardFixture(
      failureReceiptRaceSourceId,
      failureReceiptRaceForwardId,
    );

    let releaseBlocker!: () => void;
    let blockerReady!: () => void;
    let releaseProvider!: () => void;
    let providerWaiting!: () => void;
    const blockerRelease = new Promise<void>((resolve) => {
      releaseBlocker = resolve;
    });
    const blockerStarted = new Promise<void>((resolve) => {
      blockerReady = resolve;
    });
    const providerRelease = new Promise<void>((resolve) => {
      releaseProvider = resolve;
    });
    const providerStarted = new Promise<void>((resolve) => {
      providerWaiting = resolve;
    });
    const blocker = db.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`
        DO $blocker$
        BEGIN
          PERFORM pg_advisory_xact_lock(${acceptanceRaceBlockerClassId}, ${acceptanceRaceBlockerObjectId});
        END
        $blocker$
      `);
      blockerReady();
      await blockerRelease;
    });
    await blockerStarted;

    forwardProviderResult = {
      data: null,
      error: {
        message: "fixture transport error",
        statusCode: 503,
        name: "internal_server_error",
      },
    };
    beforeForwardProviderReturn = async () => {
      providerWaiting();
      await providerRelease;
    };
    providerSend.mockClear();
    const bouncedAt = new Date("2026-08-23T10:25:00.000Z");
    let delivery: Promise<unknown> | null = null;
    let receipt: Promise<unknown> | null = null;

    try {
      delivery = deliverForward(
        failureReceiptRaceForwardId,
        forwardEnvironment(),
      );
      await providerStarted;
      receipt = recordForwardEvent({
        eventId: `failure-receipt-race-bounced-${suffix}`,
        eventType: "email.bounced",
        occurredAt: bouncedAt,
        providerMessageId: `failure-receipt-race-provider-${suffix}`,
        taggedInboundForwardId: failureReceiptRaceForwardId,
      });
      await waitForAdvisoryWaiters(
        acceptanceRaceBlockerClassId,
        acceptanceRaceBlockerObjectId,
        1,
      );

      releaseProvider();
      await waitForForwardTransactionWaiter();
      releaseBlocker();

      await expect(receipt).resolves.toEqual({ handled: true, updated: 1 });
      await expect(delivery).resolves.toBe("deduplicated");
      await blocker;
    } finally {
      releaseProvider();
      releaseBlocker();
      beforeForwardProviderReturn = null;
      forwardProviderResult = {
        data: { id: "must-not-send" },
        error: null,
      };
      await Promise.allSettled(
        [blocker, delivery, receipt].filter(
          (promise): promise is Promise<unknown> => promise !== null,
        ),
      );
    }

    expect(providerSend).toHaveBeenCalledTimes(1);
    expect(
      await db.outreachInboundForward.findUniqueOrThrow({
        where: { id: failureReceiptRaceForwardId },
        select: {
          status: true,
          deliveryStatus: true,
          providerMessageId: true,
          sentAt: true,
          providerEventAt: true,
          lastFailureCode: true,
          deliveryFailureCode: true,
          deliveryLeaseToken: true,
          deliveryLeaseUntil: true,
        },
      }),
    ).toEqual({
      status: "SENT",
      deliveryStatus: "BOUNCED",
      providerMessageId: `failure-receipt-race-provider-${suffix}`,
      sentAt: bouncedAt,
      providerEventAt: bouncedAt,
      lastFailureCode: null,
      deliveryFailureCode: "recipient_bounced",
      deliveryLeaseToken: null,
      deliveryLeaseUntil: null,
    });
    expect(await exhaustionAlertCount(failureReceiptRaceForwardId)).toBe(0);
    expect(
      await deliveryFailureAlertCount(
        failureReceiptRaceForwardId,
        "recipient_bounced",
      ),
    ).toBe(1);
    expect(
      await deliverForward(failureReceiptRaceForwardId, forwardEnvironment()),
    ).toBe("deduplicated");
    expect(providerSend).toHaveBeenCalledTimes(1);
  });

  test("a late positive receipt repairs exhaustion without another provider call", async () => {
    await createForwardFixture(lateReceiptSourceId, lateReceiptForwardId);
    forwardProviderResult = {
      data: null,
      error: {
        message: "fixture rejection",
        statusCode: 422,
        name: "validation_error",
      },
    };
    beforeForwardProviderReturn = null;
    providerSend.mockClear();

    try {
      expect(
        await deliverForward(lateReceiptForwardId, forwardEnvironment()),
      ).toBe("exhausted");
      expect(providerSend).toHaveBeenCalledTimes(1);
      expect(
        await db.outreachInboundForward.findUniqueOrThrow({
          where: { id: lateReceiptForwardId },
          select: { status: true, attempts: true, lastFailureCode: true },
        }),
      ).toEqual({
        status: "EXHAUSTED",
        attempts: 3,
        lastFailureCode: "provider_rejected",
      });
      expect(await exhaustionAlertCount(lateReceiptForwardId)).toBe(1);

      providerSend.mockClear();
      const deliveredAt = new Date("2026-08-23T10:30:00.000Z");
      const providerMessageId = `late-receipt-provider-${suffix}`;
      expect(
        await recordForwardEvent({
          eventId: `late-receipt-delivered-${suffix}`,
          eventType: "email.delivered",
          occurredAt: deliveredAt,
          providerMessageId,
          taggedInboundForwardId: lateReceiptForwardId,
        }),
      ).toEqual({ handled: true, updated: 1 });
      expect(providerSend).not.toHaveBeenCalled();
      expect(
        await db.outreachInboundForward.findUniqueOrThrow({
          where: { id: lateReceiptForwardId },
          select: {
            status: true,
            deliveryStatus: true,
            providerMessageId: true,
            sentAt: true,
            providerEventAt: true,
            lastFailureCode: true,
            deliveryFailureCode: true,
            deliveryLeaseToken: true,
            deliveryLeaseUntil: true,
          },
        }),
      ).toEqual({
        status: "SENT",
        deliveryStatus: "DELIVERED",
        providerMessageId,
        sentAt: deliveredAt,
        providerEventAt: deliveredAt,
        lastFailureCode: null,
        deliveryFailureCode: null,
        deliveryLeaseToken: null,
        deliveryLeaseUntil: null,
      });
      expect(await exhaustionAlertCount(lateReceiptForwardId)).toBe(0);
      expect(
        await db.operatorAlert.count({
          where: {
            kind: "OUTREACH_SEND_FAILURE",
            title: "Inbound read-copy acceptance reconciled",
            context: { path: ["forwardId"], equals: lateReceiptForwardId },
          },
        }),
      ).toBe(1);

      expect(
        await recordForwardEvent({
          eventId: `late-receipt-stale-bounce-${suffix}`,
          eventType: "email.bounced",
          occurredAt: new Date("2026-08-23T10:29:00.000Z"),
          providerMessageId,
          taggedInboundForwardId: lateReceiptForwardId,
        }),
      ).toEqual({ handled: true, updated: 0 });
      expect(providerSend).not.toHaveBeenCalled();
      expect(
        await db.outreachInboundForward.findUniqueOrThrow({
          where: { id: lateReceiptForwardId },
          select: {
            status: true,
            deliveryStatus: true,
            providerEventAt: true,
            deliveryFailureCode: true,
          },
        }),
      ).toEqual({
        status: "SENT",
        deliveryStatus: "DELIVERED",
        providerEventAt: deliveredAt,
        deliveryFailureCode: null,
      });
      expect(
        await db.outreachForwardProviderEvent.count({
          where: { forwardId: lateReceiptForwardId },
        }),
      ).toBe(2);
      expect(
        await deliveryFailureAlertCount(
          lateReceiptForwardId,
          "recipient_bounced",
        ),
      ).toBe(0);
    } finally {
      beforeForwardProviderReturn = null;
      forwardProviderResult = {
        data: { id: "must-not-send" },
        error: null,
      };
    }
  });

  test("a tagged receipt cannot bind a configuration-only exhaustion", async () => {
    await createForwardFixture(configOnlySourceId, configOnlyForwardId, {
      status: "EXHAUSTED",
      attempts: 0,
      firstProviderAttemptAt: null,
      lastFailureCode: "configuration_invalid",
    });
    await db.operatorAlert.create({
      data: {
        fingerprint: `config-only-exhaustion-${suffix}`,
        kind: "OUTREACH_SEND_FAILURE",
        title: "Inbound read-copy forwarding exhausted",
        message: "Configuration-only exhaustion fixture.",
        context: {
          forwardId: configOnlyForwardId,
          outreachMessageId: configOnlySourceId,
          failureCode: "configuration_invalid",
        },
      },
    });
    providerSend.mockClear();

    expect(
      await recordForwardEvent({
        eventId: `config-only-unrelated-delivered-${suffix}`,
        eventType: "email.delivered",
        occurredAt: new Date("2026-08-23T10:40:00.000Z"),
        providerMessageId: `config-only-unrelated-provider-${suffix}`,
        taggedInboundForwardId: configOnlyForwardId,
      }),
    ).toEqual({ handled: true, updated: 0 });
    expect(providerSend).not.toHaveBeenCalled();
    expect(
      await db.outreachInboundForward.findUniqueOrThrow({
        where: { id: configOnlyForwardId },
        select: {
          status: true,
          attempts: true,
          firstProviderAttemptAt: true,
          sentAt: true,
          providerMessageId: true,
          deliveryStatus: true,
          lastFailureCode: true,
        },
      }),
    ).toEqual({
      status: "EXHAUSTED",
      attempts: 0,
      firstProviderAttemptAt: null,
      sentAt: null,
      providerMessageId: null,
      deliveryStatus: "PENDING",
      lastFailureCode: "configuration_invalid",
    });
    expect(
      await db.outreachForwardProviderEvent.count({
        where: { forwardId: configOnlyForwardId },
      }),
    ).toBe(1);
    expect(await exhaustionAlertCount(configOnlyForwardId)).toBe(1);
    expect(
      await db.operatorAlert.count({
        where: {
          kind: "OUTREACH_SEND_FAILURE",
          title: "Inbound read-copy acceptance reconciled",
          context: { path: ["forwardId"], equals: configOnlyForwardId },
        },
      }),
    ).toBe(0);

    const priorEventAt = new Date("2026-08-23T10:39:00.000Z");
    const preboundProviderId = `config-prebound-provider-${suffix}`;
    await createForwardFixture(configPreboundSourceId, configPreboundForwardId, {
      status: "EXHAUSTED",
      attempts: 0,
      firstProviderAttemptAt: new Date("2026-08-23T10:38:00.000Z"),
      lastFailureCode: "configuration_invalid",
      providerMessageId: preboundProviderId,
      providerEventAt: priorEventAt,
      deliveryStatus: "SENT",
    });
    await db.operatorAlert.create({
      data: {
        fingerprint: `config-prebound-exhaustion-${suffix}`,
        kind: "OUTREACH_SEND_FAILURE",
        title: "Inbound read-copy forwarding exhausted",
        message: "Prebound configuration-only exhaustion fixture.",
        context: {
          forwardId: configPreboundForwardId,
          outreachMessageId: configPreboundSourceId,
          failureCode: "configuration_invalid",
        },
      },
    });
    expect(
      await recordForwardEvent({
        eventId: `config-prebound-bounced-${suffix}`,
        eventType: "email.bounced",
        occurredAt: new Date("2026-08-23T10:41:00.000Z"),
        providerMessageId: preboundProviderId,
        taggedInboundForwardId: configPreboundForwardId,
      }),
    ).toEqual({ handled: true, updated: 0 });
    expect(
      await configOnlyForwardSnapshot(configPreboundForwardId),
    ).toEqual({
      status: "EXHAUSTED",
      attempts: 0,
      firstProviderAttemptAt: new Date("2026-08-23T10:38:00.000Z"),
      sentAt: null,
      providerMessageId: preboundProviderId,
      providerEventAt: priorEventAt,
      deliveryStatus: "SENT",
      lastFailureCode: "configuration_invalid",
    });
    expect(await exhaustionAlertCount(configPreboundForwardId)).toBe(1);
    expect(
      await deliveryFailureAlertCount(
        configPreboundForwardId,
        "recipient_bounced",
      ),
    ).toBe(0);

    const missingFirstProviderId = `config-missing-first-provider-${suffix}`;
    await createForwardFixture(
      configMissingFirstSourceId,
      configMissingFirstForwardId,
      {
        status: "EXHAUSTED",
        attempts: 1,
        firstProviderAttemptAt: null,
        lastFailureCode: "configuration_invalid",
        providerMessageId: missingFirstProviderId,
        providerEventAt: priorEventAt,
        deliveryStatus: "SENT",
      },
    );
    await db.operatorAlert.create({
      data: {
        fingerprint: `config-missing-first-exhaustion-${suffix}`,
        kind: "OUTREACH_SEND_FAILURE",
        title: "Inbound read-copy forwarding exhausted",
        message: "Missing-attempt-time exhaustion fixture.",
        context: {
          forwardId: configMissingFirstForwardId,
          outreachMessageId: configMissingFirstSourceId,
          failureCode: "configuration_invalid",
        },
      },
    });
    expect(
      await recordForwardEvent({
        eventId: `config-missing-first-failed-${suffix}`,
        eventType: "email.failed",
        occurredAt: new Date("2026-08-23T10:42:00.000Z"),
        providerMessageId: missingFirstProviderId,
      }),
    ).toEqual({ handled: true, updated: 0 });
    expect(
      await configOnlyForwardSnapshot(configMissingFirstForwardId),
    ).toEqual({
      status: "EXHAUSTED",
      attempts: 1,
      firstProviderAttemptAt: null,
      sentAt: null,
      providerMessageId: missingFirstProviderId,
      providerEventAt: priorEventAt,
      deliveryStatus: "SENT",
      lastFailureCode: "configuration_invalid",
    });
    expect(await exhaustionAlertCount(configMissingFirstForwardId)).toBe(1);
    expect(
      await deliveryFailureAlertCount(
        configMissingFirstForwardId,
        "provider_reported_failure",
      ),
    ).toBe(0);
    expect(providerSend).not.toHaveBeenCalled();
  });
});

async function createForwardFixture(
  sourceId: string,
  forwardId: string,
  overrides: Partial<{
    status: "PENDING" | "SENT" | "EXHAUSTED";
    attempts: number;
    firstProviderAttemptAt: Date | null;
    lastFailureCode: string | null;
    providerMessageId: string | null;
    providerEventAt: Date | null;
    deliveryStatus:
      | "PENDING"
      | "SENT"
      | "DELIVERED"
      | "BOUNCED"
      | "COMPLAINED"
      | "SUPPRESSED"
      | "FAILED";
  }> = {},
) {
  await db.outreachMessage.create({
    data: {
      id: sourceId,
      idempotencyKey: `inbound-forward-source:${sourceId}`,
      siteId,
      direction: "INBOUND",
      providerMessageId: `${sourceId}-provider`,
      fromAddress: `fixture-owner@${slug}.example.test`,
      toAddress: "vincent@reply.restofront.com",
      subject: "Re: preview",
      textBody: "Acceptance fence fixture.",
      status: "RECEIVED",
      receivedAt: new Date(),
    },
  });
  await db.outreachInboundForward.create({
    data: {
      id: forwardId,
      outreachMessageId: sourceId,
      idempotencyKey: `outreach-inbound-forward:${sourceId}`,
      targetAddress: "operator@example.test",
      senderAddress: "Cornershopdev <vincent@send.cornershop.dev>",
      siteName: "Acceptance fence fixture",
      siteSlug: slug,
      attempts: 2,
      firstProviderAttemptAt: new Date(Date.now() - 60_000),
      lastFailureCode: "provider_unavailable",
      ...overrides,
    },
  });
}

function forwardEnvironment() {
  return {
    EMAIL_FROM: "Cornershopdev <vincent@send.cornershop.dev>",
    EMAIL_REPLY_TO: "vincent@reply.cornershop.dev",
    OUTREACH_INBOUND_FORWARD_TO: "operator@example.test",
  };
}

function configOnlyForwardSnapshot(forwardId: string) {
  return db.outreachInboundForward.findUniqueOrThrow({
    where: { id: forwardId },
    select: {
      status: true,
      attempts: true,
      firstProviderAttemptAt: true,
      sentAt: true,
      providerMessageId: true,
      providerEventAt: true,
      deliveryStatus: true,
      lastFailureCode: true,
    },
  });
}

function exhaustionAlertCount(forwardId: string) {
  return db.operatorAlert.count({
    where: {
      kind: "OUTREACH_SEND_FAILURE",
      title: "Inbound read-copy forwarding exhausted",
      context: { path: ["forwardId"], equals: forwardId },
    },
  });
}

function deliveryFailureAlertCount(forwardId: string, failureCode: string) {
  return db.operatorAlert.count({
    where: {
      kind: "OUTREACH_SEND_FAILURE",
      title: "Inbound read-copy delivery failed",
      AND: [
        { context: { path: ["forwardId"], equals: forwardId } },
        { context: { path: ["failureCode"], equals: failureCode } },
      ],
    },
  });
}

async function waitForAdvisoryWaiter(): Promise<void> {
  return waitForAdvisoryWaiters(blockerClassId, blockerObjectId, 1);
}

async function waitForAdvisoryWaiters(
  classId: number,
  objectId: number,
  expected: number,
): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const rows = await db.$queryRaw<Array<{ waiting: number }>>`
      SELECT COUNT(*)::int AS waiting
      FROM pg_locks
      WHERE locktype = 'advisory'
        AND classid = ${classId}
        AND objid = ${objectId}
        AND NOT granted
    `;
    if ((rows[0]?.waiting ?? 0) >= expected) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(
    `Expected ${expected} transaction(s) at the advisory-lock barrier`,
  );
}

async function waitForForwardTransactionWaiter(): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const rows = await db.$queryRaw<Array<{ waiting: number }>>`
      SELECT COUNT(*)::int AS waiting
      FROM pg_locks AS lock
      JOIN pg_stat_activity AS activity ON activity.pid = lock.pid
      WHERE lock.locktype = 'transactionid'
        AND NOT lock.granted
        AND activity.datname = current_database()
        AND activity.query LIKE '%OutreachInboundForward%'
    `;
    if ((rows[0]?.waiting ?? 0) >= 1) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("Expected exhaustion to wait on the accepted forward row");
}
