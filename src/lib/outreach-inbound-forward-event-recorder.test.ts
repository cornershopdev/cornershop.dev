import { describe, expect, it, mock } from "bun:test";
import type { PrismaClient } from "@/generated/prisma/client";

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

  it("records delivery once, reconciles an early receipt, and never mutates the source message", async () => {
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
      status: "PENDING",
      deliveryStatus: "DELIVERED",
      providerMessageId: "resend_forward_1",
      providerEventAt: delivered.occurredAt,
      deliveredAt: delivered.occurredAt,
      deliveryLeaseToken: "lease_1",
      deliveryLeaseUntil: new Date("2026-08-23T10:05:00.000Z"),
      lastFailureCode: "provider_unavailable",
    });
    expect(fixture.state.sourceMessage).toEqual(sourceBefore);
    expect(fixture.state.alerts).toHaveLength(0);
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
        where: {
          id: string;
          deliveryStatus: { in: DeliveryStatus[] };
          OR: Array<{ providerMessageId: string | null }>;
          AND: Array<{
            OR: Array<{
              providerEventAt: null | { lte: Date };
            }>;
          }>;
        };
        data: Partial<typeof state.forward>;
      }) => {
        if (providerIdBeforeNextUpdate) {
          state.forward.providerMessageId = providerIdBeforeNextUpdate;
          providerIdBeforeNextUpdate = null;
        }
        const providerMatches = input.where.OR.some(
          ({ providerMessageId }) =>
            providerMessageId === state.forward.providerMessageId,
        );
        const eventAtMatches = input.where.AND[0]!.OR.some((condition) => {
          if (condition.providerEventAt === null) {
            return state.forward.providerEventAt === null;
          }
          return (
            state.forward.providerEventAt !== null &&
            state.forward.providerEventAt <= condition.providerEventAt.lte
          );
        });
        if (
          input.where.id !== state.forward.id ||
          !input.where.deliveryStatus.in.includes(
            state.forward.deliveryStatus,
          ) ||
          !providerMatches ||
          !eventAtMatches
        ) {
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
        state.alerts.push(input.create);
        return { id: "alert_1", occurrenceCount: 1, status: "PENDING" };
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
