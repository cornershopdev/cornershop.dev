import { describe, expect, it, mock } from "bun:test";
import type { PrismaClient } from "@/generated/prisma/client";
import { OUTREACH_INBOUND_FORWARD_EXHAUSTION_ALERT_TITLE } from "@/lib/outreach-inbound-forward-policy";

mock.module("server-only", () => ({}));

const { recordResendInboundForwardEvent } = await import(
  "@/lib/outreach-inbound-forward-event-recorder"
);

describe("inbound read-copy provider event persistence", () => {
  it("applies an exact sent receipt only once", async () => {
    const fixture = deliveryFixture();
    const sent = eventInput({
      eventId: "webhook_sent",
      eventType: "email.sent",
    });

    expect(await recordResendInboundForwardEvent(sent, fixture.db)).toEqual({
      handled: true,
      updated: 1,
    });
    expect(await recordResendInboundForwardEvent(sent, fixture.db)).toEqual({
      handled: true,
      updated: 0,
    });
    expect(fixture.state.events).toHaveLength(1);
    expect(fixture.state.forward.deliveryStatus).toBe("SENT");
  });

  it("records delivery, atomically accepts the outbox, and never mutates the source message", async () => {
    const fixture = deliveryFixture();
    const sourceBefore = structuredClone(fixture.state.sourceMessage);
    const delivered = eventInput({
      eventId: "webhook_delivered",
      eventType: "email.delivered",
      occurredAt: new Date("2026-08-23T10:01:00.000Z"),
    });

    expect(
      await recordResendInboundForwardEvent(delivered, fixture.db),
    ).toEqual({ handled: true, updated: 1 });
    expect(
      await recordResendInboundForwardEvent(delivered, fixture.db),
    ).toEqual({ handled: true, updated: 0 });

    expect(fixture.state.events).toHaveLength(1);
    expect(fixture.state.forward).toMatchObject({
      status: "SENT",
      deliveryStatus: "DELIVERED",
      providerMessageId: "resend_forward_1",
      providerEventAt: delivered.occurredAt,
      deliveredAt: delivered.occurredAt,
      deliveryLeaseToken: null,
      deliveryLeaseUntil: null,
      lastFailureCode: null,
    });
    expect(fixture.state.sourceMessage).toEqual(sourceBefore);
    expect(fixture.state.alerts).toHaveLength(0);
  });

  it("settles every signed receipt after a durable attempt while keeping delivery outcomes separate", async () => {
    const cases = [
      ["email.sent", "SENT", null],
      ["email.delivered", "DELIVERED", null],
      ["email.failed", "FAILED", "provider_reported_failure"],
      ["email.suppressed", "SUPPRESSED", "provider_suppressed"],
      ["email.bounced", "BOUNCED", "recipient_bounced"],
      ["email.complained", "COMPLAINED", "recipient_complained"],
    ] as const;

    for (const [eventType, deliveryStatus, deliveryFailureCode] of cases) {
      const fixture = deliveryFixture();
      const occurredAt = new Date("2026-08-23T10:02:00.000Z");
      expect(
        await recordResendInboundForwardEvent(
          eventInput({
            eventId: `webhook_acceptance_${deliveryStatus.toLowerCase()}`,
            eventType,
            occurredAt,
          }),
          fixture.db,
        ),
      ).toEqual({ handled: true, updated: 1 });
      expect(fixture.state.forward).toMatchObject({
        status: "SENT",
        sentAt: occurredAt,
        providerMessageId: "resend_forward_1",
        deliveryStatus,
        providerEventAt: occurredAt,
        deliveryFailureCode,
        lastFailureCode: null,
        deliveryLeaseToken: null,
        deliveryLeaseUntil: null,
      });
      expect(fixture.state.alerts).toHaveLength(
        deliveryFailureCode ? 1 : 0,
      );
    }
  });

  it("repairs a late positive receipt and keeps stale failure evidence from regressing it", async () => {
    const fixture = deliveryFixture({
      status: "EXHAUSTED",
      lastFailureCode: "provider_unavailable",
      deliveryLeaseToken: null,
      deliveryLeaseUntil: null,
    });
    fixture.state.alerts.push({
      id: "alert_exhausted",
      kind: "OUTREACH_SEND_FAILURE",
      status: "PENDING",
      title: OUTREACH_INBOUND_FORWARD_EXHAUSTION_ALERT_TITLE,
      context: { forwardId: "forward_1", failureCode: "provider_unavailable" },
    });
    const delivered = eventInput({
      eventId: "webhook_late_delivered",
      eventType: "email.delivered",
      occurredAt: new Date("2026-08-23T10:05:00.000Z"),
    });

    expect(
      await recordResendInboundForwardEvent(delivered, fixture.db),
    ).toEqual({ handled: true, updated: 1 });
    expect(fixture.state.forward).toMatchObject({
      status: "SENT",
      deliveryStatus: "DELIVERED",
      providerMessageId: "resend_forward_1",
      providerEventAt: delivered.occurredAt,
      sentAt: delivered.occurredAt,
      lastFailureCode: null,
      deliveryLeaseToken: null,
      deliveryLeaseUntil: null,
    });
    expect(fixture.state.alerts).toEqual([
      expect.objectContaining({
        status: "PENDING",
        title: "Inbound read-copy acceptance reconciled",
        context: {
          forwardId: "forward_1",
          outreachMessageId: "inbound_1",
          failureCode: "provider_acceptance_reconciled",
        },
      }),
    ]);

    const staleFailure = eventInput({
      eventId: "webhook_stale_after_acceptance",
      eventType: "email.bounced",
      occurredAt: new Date("2026-08-23T10:04:00.000Z"),
    });
    expect(
      await recordResendInboundForwardEvent(staleFailure, fixture.db),
    ).toEqual({ handled: true, updated: 0 });
    expect(fixture.state.events).toHaveLength(2);
    expect(fixture.state.forward).toMatchObject({
      status: "SENT",
      deliveryStatus: "DELIVERED",
      providerEventAt: delivered.occurredAt,
      deliveryFailureCode: null,
    });
    expect(fixture.state.alerts).toHaveLength(1);
  });

  it("does not bind a tagged receipt to a configuration-only exhaustion", async () => {
    const fixture = deliveryFixture({
      status: "EXHAUSTED",
      attempts: 0,
      firstProviderAttemptAt: null,
      lastFailureCode: "configuration_invalid",
      deliveryLeaseToken: null,
      deliveryLeaseUntil: null,
    });
    fixture.state.alerts.push({
      id: "alert_configuration_exhausted",
      kind: "OUTREACH_SEND_FAILURE",
      status: "PENDING",
      title: OUTREACH_INBOUND_FORWARD_EXHAUSTION_ALERT_TITLE,
      context: {
        forwardId: "forward_1",
        failureCode: "configuration_invalid",
      },
    });

    expect(
      await recordResendInboundForwardEvent(
        eventInput({
          eventId: "webhook_unattempted_delivered",
          eventType: "email.delivered",
        }),
        fixture.db,
      ),
    ).toEqual({ handled: true, updated: 0 });
    expect(fixture.state.events).toHaveLength(1);
    expect(fixture.state.forward).toMatchObject({
      status: "EXHAUSTED",
      attempts: 0,
      firstProviderAttemptAt: null,
      providerMessageId: null,
      deliveryStatus: "PENDING",
      sentAt: null,
      lastFailureCode: "configuration_invalid",
    });
    expect(fixture.state.alerts).toEqual([
      expect.objectContaining({
        id: "alert_configuration_exhausted",
        title: OUTREACH_INBOUND_FORWARD_EXHAUSTION_ALERT_TITLE,
      }),
    ]);
  });

  it("does not resurrect prebound configuration-only rows through either identity lookup", async () => {
    const cases = [
      {
        attempts: 0,
        firstProviderAttemptAt: new Date("2026-08-23T10:00:00.000Z"),
        taggedInboundForwardId: "forward_1" as string | undefined,
      },
      {
        attempts: 1,
        firstProviderAttemptAt: null,
        taggedInboundForwardId: undefined,
      },
    ];

    for (const [index, attemptEvidence] of cases.entries()) {
      const previousEventAt = new Date("2026-08-23T10:00:00.000Z");
      const fixture = deliveryFixture({
        status: "EXHAUSTED",
        attempts: attemptEvidence.attempts,
        firstProviderAttemptAt: attemptEvidence.firstProviderAttemptAt,
        providerMessageId: "resend_forward_1",
        providerEventAt: previousEventAt,
        deliveryStatus: "SENT",
        sentAt: null,
        lastFailureCode: "configuration_invalid",
        deliveryLeaseToken: null,
        deliveryLeaseUntil: null,
      });
      fixture.state.alerts.push({
        id: `alert_configuration_prebound_${index}`,
        kind: "OUTREACH_SEND_FAILURE",
        status: "PENDING",
        title: OUTREACH_INBOUND_FORWARD_EXHAUSTION_ALERT_TITLE,
        context: {
          forwardId: "forward_1",
          failureCode: "configuration_invalid",
        },
      });

      expect(
        await recordResendInboundForwardEvent(
          eventInput({
            eventId: `webhook_configuration_prebound_${index}`,
            eventType: "email.bounced",
            occurredAt: new Date("2026-08-23T10:03:00.000Z"),
            taggedInboundForwardId: attemptEvidence.taggedInboundForwardId,
          }),
          fixture.db,
        ),
      ).toEqual({ handled: true, updated: 0 });
      expect(fixture.state.forward).toMatchObject({
        status: "EXHAUSTED",
        attempts: attemptEvidence.attempts,
        firstProviderAttemptAt: attemptEvidence.firstProviderAttemptAt,
        providerMessageId: "resend_forward_1",
        providerEventAt: previousEventAt,
        deliveryStatus: "SENT",
        sentAt: null,
        lastFailureCode: "configuration_invalid",
      });
      expect(fixture.state.events).toHaveLength(1);
      expect(fixture.state.alerts).toHaveLength(1);
    }
  });

  it("repairs late failure evidence without retaining a false exhaustion alert", async () => {
    const fixture = deliveryFixture({
      status: "EXHAUSTED",
      lastFailureCode: "provider_unavailable",
      deliveryLeaseToken: null,
      deliveryLeaseUntil: null,
    });
    fixture.state.alerts.push({
      id: "alert_false_exhaustion",
      kind: "OUTREACH_SEND_FAILURE",
      status: "PENDING",
      title: OUTREACH_INBOUND_FORWARD_EXHAUSTION_ALERT_TITLE,
      context: { forwardId: "forward_1", failureCode: "provider_unavailable" },
    });

    expect(
      await recordResendInboundForwardEvent(
        eventInput({
          eventId: "webhook_late_bounced",
          eventType: "email.bounced",
          occurredAt: new Date("2026-08-23T10:06:00.000Z"),
        }),
        fixture.db,
      ),
    ).toEqual({ handled: true, updated: 1 });
    expect(fixture.state.forward).toMatchObject({
      status: "SENT",
      deliveryStatus: "BOUNCED",
      deliveryFailureCode: "recipient_bounced",
      lastFailureCode: null,
    });
    expect(
      fixture.state.alerts.filter(
        (alert) =>
          alert.title === OUTREACH_INBOUND_FORWARD_EXHAUSTION_ALERT_TITLE,
      ),
    ).toHaveLength(0);
    expect(fixture.state.alerts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          title: "Inbound read-copy acceptance reconciled",
        }),
        expect.objectContaining({
          title: "Inbound read-copy delivery failed",
          context: expect.objectContaining({
            failureCode: "recipient_bounced",
          }),
        }),
      ]),
    );
  });

  it("repairs acceptance independently of a newer terminal delivery snapshot", async () => {
    const newerFailureAt = new Date("2026-08-23T10:05:00.000Z");
    const fixture = deliveryFixture({
      status: "EXHAUSTED",
      deliveryStatus: "FAILED",
      providerMessageId: "resend_forward_1",
      providerEventAt: newerFailureAt,
      lastFailureCode: "provider_unavailable",
      deliveryLeaseToken: null,
      deliveryLeaseUntil: null,
    });

    expect(
      await recordResendInboundForwardEvent(
        eventInput({
          eventId: "webhook_older_sent_acceptance",
          eventType: "email.sent",
          occurredAt: new Date("2026-08-23T10:04:00.000Z"),
        }),
        fixture.db,
      ),
    ).toEqual({ handled: true, updated: 1 });
    expect(fixture.state.forward).toMatchObject({
      status: "SENT",
      deliveryStatus: "FAILED",
      providerEventAt: newerFailureAt,
      lastFailureCode: null,
    });
  });

  it("repairs an exhausted identity conflict without clearing its alert marker", async () => {
    const fixture = deliveryFixture({
      status: "EXHAUSTED",
      providerMessageId: "resend_forward_1",
      sentAt: new Date("2026-08-23T10:00:00.000Z"),
      lastFailureCode: "provider_identity_conflict",
      deliveryLeaseToken: null,
      deliveryLeaseUntil: null,
    });

    expect(
      await recordResendInboundForwardEvent(
        eventInput({
          eventId: "webhook_identity_marker_sent",
          eventType: "email.sent",
        }),
        fixture.db,
      ),
    ).toEqual({ handled: true, updated: 1 });
    expect(fixture.state.forward).toMatchObject({
      status: "SENT",
      deliveryStatus: "SENT",
      lastFailureCode: "provider_identity_conflict",
    });
  });

  it("records a newer bounce once and enqueues one content-free alert atomically", async () => {
    const fixture = deliveryFixture({
      status: "SENT",
      deliveryStatus: "DELIVERED",
      providerMessageId: "resend_forward_1",
      providerEventAt: new Date("2026-08-23T10:01:00.000Z"),
      deliveredAt: new Date("2026-08-23T10:01:00.000Z"),
    });
    const bounced = eventInput({
      eventId: "webhook_bounced",
      eventType: "email.bounced",
      occurredAt: new Date("2026-08-23T10:02:00.000Z"),
    });

    expect(
      await recordResendInboundForwardEvent(bounced, fixture.db),
    ).toEqual({ handled: true, updated: 1 });
    expect(
      await recordResendInboundForwardEvent(bounced, fixture.db),
    ).toEqual({ handled: true, updated: 0 });

    expect(fixture.state.events).toHaveLength(1);
    expect(fixture.state.forward).toMatchObject({
      status: "SENT",
      deliveryStatus: "BOUNCED",
      deliveryFailureCode: "recipient_bounced",
    });
    expect(fixture.state.alerts).toHaveLength(1);
    expect(fixture.state.alerts[0]).toMatchObject({
      kind: "OUTREACH_SEND_FAILURE",
      context: {
        forwardId: "forward_1",
        outreachMessageId: "inbound_1",
        failureCode: "recipient_bounced",
      },
    });
    const serialized = JSON.stringify(fixture.state.alerts[0]);
    expect(serialized).not.toContain("operator@example.test");
    expect(serialized).not.toContain("private mailbox body");
    expect(serialized).not.toContain("owner@example.test");
  });

  it("persists stale evidence without regressing the receipt snapshot", async () => {
    const fixture = deliveryFixture({
      status: "SENT",
      deliveryStatus: "DELIVERED",
      providerMessageId: "resend_forward_1",
      providerEventAt: new Date("2026-08-23T10:02:00.000Z"),
      deliveredAt: new Date("2026-08-23T10:02:00.000Z"),
    });

    expect(
      await recordResendInboundForwardEvent(
        eventInput({
          eventId: "webhook_stale_bounce",
          eventType: "email.bounced",
          occurredAt: new Date("2026-08-23T10:01:00.000Z"),
        }),
        fixture.db,
      ),
    ).toEqual({ handled: true, updated: 0 });
    expect(fixture.state.events).toHaveLength(1);
    expect(fixture.state.forward.deliveryStatus).toBe("DELIVERED");
    expect(fixture.state.alerts).toHaveLength(0);
  });

  it("uses the unique provider id only when the stable forward tag is absent", async () => {
    const fixture = deliveryFixture({
      status: "SENT",
      deliveryStatus: "SENT",
      providerMessageId: "resend_forward_1",
    });

    expect(
      await recordResendInboundForwardEvent(
        eventInput({
          taggedInboundForwardId: undefined,
          eventId: "webhook_provider_fallback",
          eventType: "email.delivered",
        }),
        fixture.db,
      ),
    ).toEqual({ handled: true, updated: 1 });
    expect(fixture.state.forward.deliveryStatus).toBe("DELIVERED");
  });

  it("returns not found without mutation when both tag and provider lookup miss", async () => {
    const fixture = deliveryFixture({
      status: "SENT",
      deliveryStatus: "SENT",
      providerMessageId: "resend_forward_bound",
    });

    expect(
      await recordResendInboundForwardEvent(
        eventInput({
          taggedInboundForwardId: undefined,
          providerMessageId: "resend_forward_unknown",
          eventId: "webhook_unknown_provider",
          eventType: "email.delivered",
        }),
        fixture.db,
      ),
    ).toEqual({ handled: false, updated: 0, reason: "not_found" });
    expect(fixture.state.events).toHaveLength(0);
    expect(fixture.state.alerts).toHaveLength(0);
    expect(fixture.state.forward).toMatchObject({
      deliveryStatus: "SENT",
      providerMessageId: "resend_forward_bound",
    });
  });

  it("persists a suppressed receipt distinctly and alerts once", async () => {
    const fixture = deliveryFixture({
      status: "SENT",
      deliveryStatus: "SENT",
      providerMessageId: "resend_forward_1",
    });

    expect(
      await recordResendInboundForwardEvent(
        eventInput({
          eventId: "webhook_suppressed",
          eventType: "email.suppressed",
        }),
        fixture.db,
      ),
    ).toEqual({ handled: true, updated: 1 });
    expect(fixture.state.forward).toMatchObject({
      status: "SENT",
      deliveryStatus: "SUPPRESSED",
      deliveryFailureCode: "provider_suppressed",
    });
    expect(fixture.state.alerts).toHaveLength(1);
  });

  it("persists a complaint distinctly and alerts once", async () => {
    const fixture = deliveryFixture({
      status: "SENT",
      deliveryStatus: "DELIVERED",
      providerMessageId: "resend_forward_1",
    });

    expect(
      await recordResendInboundForwardEvent(
        eventInput({
          eventId: "webhook_complained",
          eventType: "email.complained",
        }),
        fixture.db,
      ),
    ).toEqual({ handled: true, updated: 1 });
    expect(fixture.state.forward).toMatchObject({
      status: "SENT",
      deliveryStatus: "COMPLAINED",
      deliveryFailureCode: "recipient_complained",
    });
    expect(fixture.state.alerts).toHaveLength(1);
  });

  it("fails closed when an authoritative tag is unknown even if the provider id matches another row", async () => {
    const fixture = deliveryFixture({
      status: "SENT",
      deliveryStatus: "SENT",
      providerMessageId: "resend_forward_1",
    });

    expect(
      await recordResendInboundForwardEvent(
        eventInput({
          taggedInboundForwardId: "forward_unknown",
          eventId: "webhook_wrong_tag",
          eventType: "email.delivered",
        }),
        fixture.db,
      ),
    ).toEqual({ handled: false, updated: 0, reason: "not_found" });
    expect(fixture.state.events).toHaveLength(0);
    expect(fixture.state.forward.deliveryStatus).toBe("SENT");
  });

  it("isolates a provider identity conflict and alerts without mutating receipt state", async () => {
    const fixture = deliveryFixture({
      status: "SENT",
      deliveryStatus: "SENT",
      providerMessageId: "resend_forward_bound",
    });

    expect(
      await recordResendInboundForwardEvent(
        eventInput({
          providerMessageId: "resend_forward_other",
          eventId: "webhook_identity_conflict",
          eventType: "email.failed",
        }),
        fixture.db,
      ),
    ).toEqual({
      handled: false,
      updated: 0,
      reason: "identity_conflict",
    });
    expect(fixture.state.forward).toMatchObject({
      deliveryStatus: "SENT",
      providerMessageId: "resend_forward_bound",
    });
    expect(fixture.state.events).toEqual([
      expect.objectContaining({
        id: "webhook_identity_conflict",
        forwardId: "forward_1",
        providerMessageId: "resend_forward_other",
        eventType: "email.failed",
      }),
    ]);
    expect(fixture.state.alerts).toHaveLength(1);
  });

  it("detects a provider identity bound by a concurrent receipt after the initial read", async () => {
    const fixture = deliveryFixture();
    fixture.bindProviderBeforeNextUpdate("resend_forward_winner");

    expect(
      await recordResendInboundForwardEvent(
        eventInput({
          providerMessageId: "resend_forward_loser",
          eventId: "webhook_concurrent_identity_conflict",
          eventType: "email.delivered",
        }),
        fixture.db,
      ),
    ).toEqual({
      handled: false,
      updated: 0,
      reason: "identity_conflict",
    });
    expect(fixture.state.events).toHaveLength(1);
    expect(fixture.state.forward).toMatchObject({
      deliveryStatus: "PENDING",
      providerMessageId: "resend_forward_winner",
    });
    expect(fixture.state.alerts).toHaveLength(1);
  });

  it("rejects an altered replay identity and rolls back every mutation", async () => {
    const fixture = deliveryFixture({
      status: "SENT",
      deliveryStatus: "SENT",
      providerMessageId: "resend_forward_1",
    });
    const original = eventInput({ eventId: "webhook_reused" });
    await recordResendInboundForwardEvent(original, fixture.db);
    const snapshot = structuredClone(fixture.state);

    await expect(
      recordResendInboundForwardEvent(
        { ...original, eventType: "email.bounced" },
        fixture.db,
      ),
    ).rejects.toThrow("event identity mismatch");
    expect(fixture.state).toEqual(snapshot);
  });

  it("rolls receipt, event, and alert state back together when alert persistence fails", async () => {
    const fixture = deliveryFixture({
      status: "SENT",
      deliveryStatus: "SENT",
      providerMessageId: "resend_forward_1",
    });
    fixture.failNextAlert();
    const failed = eventInput({
      eventId: "webhook_failed_atomic",
      eventType: "email.failed",
    });

    await expect(
      recordResendInboundForwardEvent(failed, fixture.db),
    ).rejects.toThrow("fixture alert persistence failure");
    expect(fixture.state.events).toHaveLength(0);
    expect(fixture.state.alerts).toHaveLength(0);
    expect(fixture.state.forward.deliveryStatus).toBe("SENT");

    expect(
      await recordResendInboundForwardEvent(failed, fixture.db),
    ).toEqual({ handled: true, updated: 1 });
    expect(fixture.state.events).toHaveLength(1);
    expect(fixture.state.alerts).toHaveLength(1);
  });
});

type DeliveryStatus =
  | "PENDING"
  | "SENT"
  | "DELIVERED"
  | "BOUNCED"
  | "COMPLAINED"
  | "SUPPRESSED"
  | "FAILED";

function deliveryFixture(
  initial: Partial<{
    status: "PENDING" | "SENT" | "EXHAUSTED";
    deliveryStatus: DeliveryStatus;
    providerMessageId: string | null;
    providerEventAt: Date | null;
    deliveredAt: Date | null;
    sentAt: Date | null;
    attempts: number;
    firstProviderAttemptAt: Date | null;
    lastFailureCode: string | null;
    deliveryLeaseToken: string | null;
    deliveryLeaseUntil: Date | null;
  }> = {},
) {
  const state = {
    forward: {
      id: "forward_1",
      outreachMessageId: "inbound_1",
      status: "PENDING" as "PENDING" | "SENT" | "EXHAUSTED",
      deliveryStatus: "PENDING" as DeliveryStatus,
      providerMessageId: null as string | null,
      providerEventAt: null as Date | null,
      sentAt: null as Date | null,
      attempts: 1,
      firstProviderAttemptAt: new Date(
        "2026-08-23T10:00:00.000Z",
      ) as Date | null,
      deliveredAt: null as Date | null,
      deliveryFailureCode: null as string | null,
      lastFailureCode: "provider_unavailable" as string | null,
      deliveryLeaseToken: "lease_1" as string | null,
      deliveryLeaseUntil: new Date("2026-08-23T10:05:00.000Z") as Date | null,
      ...initial,
    },
    sourceMessage: {
      id: "inbound_1",
      direction: "INBOUND",
      status: "RECEIVED",
      textBody: "private mailbox body",
      threadKey: "lead:site_1",
    },
    events: [] as Array<{
      id: string;
      forwardId: string;
      providerMessageId: string;
      eventType: string;
      deliveryStatus: DeliveryStatus;
      occurredAt: Date;
    }>,
    alerts: [] as Array<Record<string, unknown>>,
  };
  let failAlert = false;
  let providerIdBeforeNextUpdate: string | null = null;

  const tx = {
    outreachInboundForward: {
      findUnique: async ({ where }: { where: Record<string, string> }) => {
        if (where.id !== undefined) {
          return where.id === state.forward.id ? state.forward : null;
        }
        return where.providerMessageId === state.forward.providerMessageId
          ? state.forward
          : null;
      },
      updateMany: async (input: {
        where: Record<string, unknown>;
        data: Partial<typeof state.forward>;
      }) => {
        if (providerIdBeforeNextUpdate) {
          state.forward.providerMessageId = providerIdBeforeNextUpdate;
          providerIdBeforeNextUpdate = null;
        }
        if (!matchesRecorderWhere(state.forward, input.where)) {
          return { count: 0 };
        }
        for (const [key, value] of Object.entries(input.data)) {
          if (value !== undefined) {
            (state.forward as Record<string, unknown>)[key] = value;
          }
        }
        return { count: 1 };
      },
    },
    outreachForwardProviderEvent: {
      upsert: async (input: {
        where: { id: string };
        create: (typeof state.events)[number];
      }) => {
        const existing = state.events.find(
          (event) => event.id === input.where.id,
        );
        if (existing) return existing;
        state.events.push(input.create);
        return input.create;
      },
    },
    operatorAlert: {
      upsert: async (input: { create: Record<string, unknown> }) => {
        if (failAlert) {
          failAlert = false;
          throw new Error("fixture alert persistence failure");
        }
        state.alerts.push({
          id: `alert_${state.alerts.length + 1}`,
          status: "PENDING",
          ...input.create,
        });
        return { id: "alert_1", occurrenceCount: 1, status: "PENDING" };
      },
      findFirst: async (input: { where: Record<string, unknown> }) =>
        state.alerts.find((alert) => matchesAlertWhere(alert, input.where)) ??
        null,
      deleteMany: async (input: { where: Record<string, unknown> }) => {
        const retained = state.alerts.filter(
          (alert) => !matchesAlertWhere(alert, input.where),
        );
        const count = state.alerts.length - retained.length;
        state.alerts.splice(0, state.alerts.length, ...retained);
        return { count };
      },
    },
  };

  const db = {
    $transaction: async (
      operation: (transaction: typeof tx) => Promise<unknown>,
    ) => {
      const snapshot = structuredClone(state);
      try {
        return await operation(tx);
      } catch (error) {
        Object.assign(state, snapshot);
        throw error;
      }
    },
  } as unknown as Pick<PrismaClient, "$transaction">;

  return {
    state,
    db,
    failNextAlert: () => {
      failAlert = true;
    },
    bindProviderBeforeNextUpdate: (providerMessageId: string) => {
      providerIdBeforeNextUpdate = providerMessageId;
    },
  };
}

function matchesRecorderWhere(
  forward: Record<string, unknown>,
  where: Record<string, unknown>,
): boolean {
  return Object.entries(where).every(([key, expected]) => {
    if (key === "OR") {
      return (expected as Array<Record<string, unknown>>).some((clause) =>
        matchesRecorderWhere(forward, clause),
      );
    }
    if (key === "AND") {
      return (expected as Array<Record<string, unknown>>).every((clause) =>
        matchesRecorderWhere(forward, clause),
      );
    }
    const actual = forward[key];
    if (expected && typeof expected === "object" && !(expected instanceof Date)) {
      const comparison = expected as {
        in?: unknown[];
        not?: unknown;
        lte?: Date;
        gt?: number;
      };
      if (comparison.in) return comparison.in.includes(actual);
      if ("not" in comparison) return actual !== comparison.not;
      if (comparison.lte) {
        return actual instanceof Date && actual <= comparison.lte;
      }
      if (comparison.gt !== undefined) {
        return typeof actual === "number" && actual > comparison.gt;
      }
    }
    return actual === expected;
  });
}

function matchesAlertWhere(
  alert: Record<string, unknown>,
  where: Record<string, unknown>,
): boolean {
  return Object.entries(where).every(([key, expected]) => {
    if (key === "status" && expected && typeof expected === "object") {
      return (expected as { in: unknown[] }).in.includes(alert.status);
    }
    if (key === "context" && expected && typeof expected === "object") {
      const filter = expected as { path: string[]; equals: unknown };
      let actual = alert.context;
      for (const segment of filter.path) {
        if (!actual || typeof actual !== "object" || Array.isArray(actual)) {
          return false;
        }
        actual = (actual as Record<string, unknown>)[segment];
      }
      return actual === filter.equals;
    }
    return alert[key] === expected;
  });
}

function eventInput(
  overrides: Partial<{
    eventId: string;
    eventType:
      | "email.sent"
      | "email.delivered"
      | "email.failed"
      | "email.suppressed"
      | "email.bounced"
      | "email.complained";
    occurredAt: Date;
    providerMessageId: string;
    taggedInboundForwardId: string | undefined;
  }> = {},
) {
  return {
    eventId: "webhook_delivered",
    eventType: "email.delivered" as const,
    occurredAt: new Date("2026-08-23T10:01:00.000Z"),
    providerMessageId: "resend_forward_1",
    taggedInboundForwardId: "forward_1" as string | undefined,
    ...overrides,
  };
}
