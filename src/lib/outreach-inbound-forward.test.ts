import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  mock,
  setSystemTime,
} from "bun:test";
import type { BoundedResendEmail } from "@/lib/resend";

mock.module("server-only", () => ({}));

type ForwardRow = Record<string, unknown> & {
  id: string;
  outreachMessageId: string;
  status: "PENDING" | "SENT" | "EXHAUSTED";
  attempts: number;
  nextAttemptAt: Date;
  deliveryLeaseUntil: Date | null;
  deliveryLeaseToken: string | null;
  firstProviderAttemptAt: Date | null;
  sentAt: Date | null;
  targetAddress: string | null;
  providerMessageId: string | null;
  deliveryStatus:
    | "PENDING"
    | "SENT"
    | "DELIVERED"
    | "BOUNCED"
    | "COMPLAINED"
    | "SUPPRESSED"
    | "FAILED";
  providerEventAt: Date | null;
  deliveredAt: Date | null;
  createdAt: Date;
};

const forwards: ForwardRow[] = [];
const messages = new Map<string, Record<string, unknown>>();
const sites = new Map<string, { name: string; slug: string }>();
const alerts: Array<Record<string, unknown>> = [];
let transactionDepth = 0;
let nextForwardId = 1;
let failNextSentFinalize = false;
let failNextProviderIdentityBind = false;
let failNextOperatorAlert = false;
let failNextFailurePersist = false;
let stealLeaseBeforeFailurePersist = false;
let finalizeElsewhereBeforeExhaust = false;
let beforeProviderReturn: (() => void | Promise<void>) | null = null;
let providerResult: {
  data: { id: string } | null;
  error: {
    message: string;
    statusCode: number | null;
    name: string | null;
  } | null;
};

const providerSend = mock(
  async (email: BoundedResendEmail, idempotencyKey: string) => {
    void email;
    void idempotencyKey;
    await beforeProviderReturn?.();
    return providerResult;
  },
);

const fakeDb = {
  $transaction: async (callback: (transaction: object) => unknown) => {
    const forwardSnapshot = structuredClone(forwards);
    const alertSnapshot = structuredClone(alerts);
    transactionDepth += 1;
    try {
      return await callback(fakeDb);
    } catch (error) {
      forwards.splice(0, forwards.length, ...forwardSnapshot);
      alerts.splice(0, alerts.length, ...alertSnapshot);
      throw error;
    } finally {
      transactionDepth -= 1;
    }
  },
  outreachInboundForward: {
    upsert: async (input: {
      where: { outreachMessageId: string };
      create: Record<string, unknown>;
    }) => {
      const existing = forwards.find(
        (forward) =>
          forward.outreachMessageId === input.where.outreachMessageId,
      );
      if (existing) return existing;
      const now = new Date();
      const created: ForwardRow = {
        id: `forward_${nextForwardId++}`,
        status: "PENDING",
        attempts: 0,
        nextAttemptAt: now,
        deliveryLeaseUntil: null,
        deliveryLeaseToken: null,
        firstProviderAttemptAt: null,
        sentAt: null,
        targetAddress: null,
        providerMessageId: null,
        deliveryStatus: "PENDING",
        providerEventAt: null,
        deliveredAt: null,
        createdAt: now,
        outreachMessageId: input.where.outreachMessageId,
        ...input.create,
      };
      forwards.push(created);
      return created;
    },
    updateMany: async (input: {
      where: Record<string, unknown>;
      data: Record<string, unknown>;
    }) => {
      if (failNextSentFinalize && input.data.status === "SENT") {
        failNextSentFinalize = false;
        throw new Error("fixture database finalize failure");
      }
      if (
        failNextProviderIdentityBind &&
        input.data.status === "SENT" &&
        typeof input.data.providerMessageId === "string"
      ) {
        failNextProviderIdentityBind = false;
        throw Object.assign(new Error("fixture unique provider conflict"), {
          code: "P2002",
        });
      }
      if (
        failNextFailurePersist &&
        input.data.lastFailureCode === "provider_unavailable"
      ) {
        failNextFailurePersist = false;
        throw new Error("fixture database failure persistence loss");
      }
      if (
        stealLeaseBeforeFailurePersist &&
        input.data.lastFailureCode === "provider_unavailable"
      ) {
        stealLeaseBeforeFailurePersist = false;
        const forward = forwards.find(
          (candidate) => candidate.id === input.where.id,
        );
        if (forward) forward.deliveryLeaseToken = "successor-worker";
      }
      if (finalizeElsewhereBeforeExhaust && input.data.status === "EXHAUSTED") {
        finalizeElsewhereBeforeExhaust = false;
        const forward = forwards.find(
          (candidate) => candidate.id === input.where.id,
        );
        if (forward) {
          forward.status = "SENT";
          forward.deliveryLeaseToken = null;
          forward.deliveryLeaseUntil = null;
        }
      }
      const matching = forwards.filter((forward) =>
        matchesWhere(forward, input.where),
      );
      for (const forward of matching) applyData(forward, input.data);
      return { count: matching.length };
    },
    findMany: async (input: {
      where: Record<string, unknown>;
      take: number;
    }) =>
      forwards
        .filter((forward) => matchesWhere(forward, input.where))
        .slice(0, input.take)
        .map(({ id }) => ({ id })),
    findFirst: async (input: { where: Record<string, unknown> }) => {
      const forward = forwards.find((candidate) =>
        matchesWhere(candidate, input.where),
      );
      if (!forward) return null;
      return {
        ...forward,
        outreachMessage: messages.get(forward.outreachMessageId),
      };
    },
    findUnique: async (input: { where: Record<string, unknown> }) =>
      forwards.find((candidate) => matchesWhere(candidate, input.where)) ??
      null,
  },
  site: {
    findUniqueOrThrow: async (input: { where: { id: string } }) => {
      const site = sites.get(input.where.id);
      if (!site) throw new Error("fixture site missing");
      return site;
    },
  },
  $disconnect: async () => undefined,
};

mock.module("@/lib/db", () => ({ getDb: () => fakeDb }));
mock.module("@/lib/resend", () => ({
  sendBoundedResendEmail: providerSend,
}));
mock.module("@/lib/operator-alert-queue", () => ({
  enqueueOperatorAlert: async (
    database: unknown,
    input: Record<string, unknown>,
  ) => {
    const operatorAlert = (
      database as {
        operatorAlert?: {
          upsert?: (input: { create: Record<string, unknown> }) => unknown;
        };
      }
    ).operatorAlert;
    if (operatorAlert?.upsert) {
      return operatorAlert.upsert({ create: input });
    }
    if (failNextOperatorAlert) {
      failNextOperatorAlert = false;
      throw new Error("fixture operator alert persistence failure");
    }
    alerts.push({ ...input, createdInsideTransaction: transactionDepth > 0 });
    return { id: "alert_1", occurrenceCount: 1, status: "PENDING" };
  },
}));

const {
  deliverOutreachInboundForward,
  dispatchDueOutreachInboundForwards,
  enqueueOutreachInboundForward,
} = await import("@/lib/outreach-inbound-forward");
const enqueueDb = fakeDb as unknown as Parameters<
  typeof enqueueOutreachInboundForward
>[0];

const configuredEnvironment = {
  EMAIL_FROM: "Cornershopdev <vincent@send.cornershop.dev>",
  EMAIL_REPLY_TO: "vincent@reply.restofront.com",
  OUTREACH_INBOUND_FORWARD_TO: " Operator@Example.test ",
};

describe("inbound read-copy outbox", () => {
  beforeEach(() => {
    forwards.length = 0;
    messages.clear();
    sites.clear();
    alerts.length = 0;
    transactionDepth = 0;
    nextForwardId = 1;
    failNextSentFinalize = false;
    failNextProviderIdentityBind = false;
    failNextOperatorAlert = false;
    failNextFailurePersist = false;
    stealLeaseBeforeFailurePersist = false;
    finalizeElsewhereBeforeExhaust = false;
    beforeProviderReturn = null;
    providerSend.mockClear();
    providerResult = {
      data: { id: "resend_forward_1" },
      error: null,
    };
    sites.set("site_1", { name: "Chez Léa", slug: "chez-lea" });
    messages.set("inbound_1", {
      fromAddress: "owner@chez-lea.test",
      toAddress: "vincent@restofront.com",
      subject: "Re: your preview",
      textBody: "Looks great — can we talk?",
    });
  });

  afterEach(() => {
    setSystemTime();
  });

  it("creates no intent when forwarding is absent and one stable intent when enabled", async () => {
    expect(
      await enqueueOutreachInboundForward(
        enqueueDb,
        inboundInput(),
        { EMAIL_REPLY_TO: "vincent@reply.restofront.com" },
      ),
    ).toBe(false);
    expect(forwards).toHaveLength(0);

    await enqueueOutreachInboundForward(
      enqueueDb,
      inboundInput(),
      configuredEnvironment,
    );
    await enqueueOutreachInboundForward(
      enqueueDb,
      inboundInput(),
      configuredEnvironment,
    );

    expect(forwards).toHaveLength(1);
    expect(forwards[0]).toMatchObject({
      outreachMessageId: "inbound_1",
      idempotencyKey: "outreach-inbound-forward:inbound_1",
      targetAddress: "operator@example.test",
      senderAddress: "Cornershopdev <vincent@send.cornershop.dev>",
      siteName: "Chez Léa",
      siteSlug: "chez-lea",
      status: "PENDING",
      attempts: 0,
    });
    expect(providerSend).not.toHaveBeenCalled();
  });

  it("retains an invalid configured intent without blocking later safe delivery", async () => {
    await enqueueOutreachInboundForward(enqueueDb, inboundInput(), {
      ...configuredEnvironment,
      OUTREACH_INBOUND_FORWARD_TO: "vincent+loop@restofront.com",
    });
    expect(forwards[0]).toMatchObject({
      targetAddress: null,
      lastFailureCode: "configuration_invalid",
      status: "PENDING",
    });
    expect(providerSend).not.toHaveBeenCalled();

    const outcomes = await dispatchDueOutreachInboundForwards(
      5,
      configuredEnvironment,
    );
    expect(outcomes.sent).toBe(1);
    expect(forwards[0]).toMatchObject({
      targetAddress: "operator@example.test",
      status: "SENT",
      attempts: 1,
    });
  });

  it("leases concurrent dispatchers and sends one stable read copy", async () => {
    await enqueueOutreachInboundForward(
      enqueueDb,
      inboundInput(),
      configuredEnvironment,
    );
    const id = forwards[0]!.id;

    const outcomes = await Promise.all([
      deliverOutreachInboundForward(id, configuredEnvironment),
      deliverOutreachInboundForward(id, configuredEnvironment),
    ]);

    expect(outcomes.sort()).toEqual(["deduplicated", "sent"]);
    expect(providerSend).toHaveBeenCalledTimes(1);
    expect(providerSend.mock.calls[0]?.[0]).toMatchObject({
      to: "operator@example.test",
      subject: expect.stringContaining("Chez Léa / chez-lea"),
      text: expect.stringContaining("Looks great — can we talk?"),
      tags: [{ name: "category", value: "outreach_inbound_forward" }, {
        name: "outreach_inbound_forward_id",
        value: "forward_1",
      }, {
        name: "outreach_message_id",
        value: "inbound_1",
      }],
    });
    expect(providerSend.mock.calls[0]?.[0]).not.toHaveProperty("replyTo");
    expect(providerSend.mock.calls[0]?.[1]).toBe(
      "outreach-inbound-forward:inbound_1",
    );
  });

  it("retries an ambiguous failure with a byte-stable payload and generic state", async () => {
    await enqueueOutreachInboundForward(
      enqueueDb,
      inboundInput(),
      configuredEnvironment,
    );
    providerResult = {
      data: null,
      error: {
        message:
          "private provider response mentioning operator@example.test and mailbox body",
        statusCode: 500,
        name: "internal_server_error",
      },
    };

    const first = await dispatchDueOutreachInboundForwards(
      5,
      configuredEnvironment,
    );
    expect(first.pending).toBe(1);
    expect(forwards[0]).toMatchObject({
      status: "PENDING",
      attempts: 1,
      lastFailureCode: "provider_unavailable",
    });
    expect(JSON.stringify(forwards[0])).not.toContain("private provider response");

    forwards[0]!.nextAttemptAt = new Date(0);
    providerResult = { data: { id: "resend_forward_1" }, error: null };
    const second = await dispatchDueOutreachInboundForwards(
      5,
      configuredEnvironment,
    );
    expect(second.sent).toBe(1);
    expect(providerSend).toHaveBeenCalledTimes(2);
    expect(providerSend.mock.calls[1]?.[0]).toEqual(
      providerSend.mock.calls[0]?.[0],
    );
    expect(providerSend.mock.calls[1]?.[1]).toBe(
      providerSend.mock.calls[0]?.[1],
    );
  });

  it("replays the same provider attempt after acceptance cannot be finalized", async () => {
    await enqueueOutreachInboundForward(
      enqueueDb,
      inboundInput(),
      configuredEnvironment,
    );
    failNextSentFinalize = true;

    const first = await dispatchDueOutreachInboundForwards(
      5,
      configuredEnvironment,
    );
    expect(first.pending).toBe(1);
    expect(forwards[0]).toMatchObject({
      status: "PENDING",
      attempts: 1,
      lastFailureCode: "provider_unavailable",
    });

    forwards[0]!.nextAttemptAt = new Date(0);
    const second = await dispatchDueOutreachInboundForwards(
      5,
      configuredEnvironment,
    );
    expect(second.sent).toBe(1);
    expect(providerSend).toHaveBeenCalledTimes(2);
    expect(providerSend.mock.calls[1]).toEqual(providerSend.mock.calls[0]);
  });

  it("recovers an expired worker lease without duplicating a live lease", async () => {
    await enqueueOutreachInboundForward(
      enqueueDb,
      inboundInput(),
      configuredEnvironment,
    );
    forwards[0]!.deliveryLeaseToken = "abandoned-worker";
    forwards[0]!.deliveryLeaseUntil = new Date(0);

    expect(
      await deliverOutreachInboundForward(
        forwards[0]!.id,
        configuredEnvironment,
      ),
    ).toBe("sent");
    expect(providerSend).toHaveBeenCalledTimes(1);
  });

  it("replays a prepared third attempt after failure persistence is lost", async () => {
    await enqueueOutreachInboundForward(
      enqueueDb,
      inboundInput(),
      configuredEnvironment,
    );
    Object.assign(forwards[0]!, {
      attempts: 2,
      lastFailureCode: "provider_unavailable",
      nextAttemptAt: new Date(0),
      firstProviderAttemptAt: new Date(),
    });
    providerResult = {
      data: null,
      error: {
        message: "ambiguous third attempt",
        statusCode: 503,
        name: "internal_server_error",
      },
    };
    failNextFailurePersist = true;

    const interrupted = await dispatchDueOutreachInboundForwards(
      5,
      configuredEnvironment,
    );
    expect(interrupted.pending).toBe(1);
    expect(forwards[0]).toMatchObject({
      status: "PENDING",
      attempts: 3,
      lastFailureCode: null,
    });
    const interruptedCall = providerSend.mock.calls[0];

    forwards[0]!.deliveryLeaseUntil = new Date(0);
    forwards[0]!.nextAttemptAt = new Date(0);
    providerResult = { data: { id: "resend_forward_1" }, error: null };

    const recovered = await dispatchDueOutreachInboundForwards(
      5,
      configuredEnvironment,
    );
    expect(recovered.sent).toBe(1);
    expect(forwards[0]).toMatchObject({ status: "SENT", attempts: 3 });
    expect(providerSend).toHaveBeenCalledTimes(2);
    expect(providerSend.mock.calls[1]).toEqual(interruptedCall);
  });

  it("preserves a prepared third attempt across target change and restore", async () => {
    await enqueueOutreachInboundForward(
      enqueueDb,
      inboundInput(),
      configuredEnvironment,
    );
    Object.assign(forwards[0]!, {
      attempts: 2,
      lastFailureCode: "provider_unavailable",
      nextAttemptAt: new Date(0),
      firstProviderAttemptAt: new Date(),
    });
    providerResult = {
      data: null,
      error: {
        message: "ambiguous third attempt",
        statusCode: 503,
        name: "internal_server_error",
      },
    };
    failNextFailurePersist = true;
    await dispatchDueOutreachInboundForwards(5, configuredEnvironment);
    const interruptedCall = providerSend.mock.calls[0];

    forwards[0]!.deliveryLeaseUntil = new Date(0);
    forwards[0]!.nextAttemptAt = new Date(0);
    const blocked = await dispatchDueOutreachInboundForwards(5, {
      ...configuredEnvironment,
      OUTREACH_INBOUND_FORWARD_TO: "new-operator@example.test",
    });
    expect(blocked["configuration-invalid"]).toBe(1);
    expect(forwards[0]).toMatchObject({
      status: "PENDING",
      attempts: 3,
      targetAddress: "operator@example.test",
      lastFailureCode: null,
    });
    expect(providerSend).toHaveBeenCalledTimes(1);

    forwards[0]!.nextAttemptAt = new Date(0);
    providerResult = { data: { id: "resend_forward_1" }, error: null };
    const recovered = await dispatchDueOutreachInboundForwards(
      5,
      configuredEnvironment,
    );

    expect(recovered.sent).toBe(1);
    expect(forwards[0]).toMatchObject({ status: "SENT", attempts: 3 });
    expect(providerSend).toHaveBeenCalledTimes(2);
    expect(providerSend.mock.calls[1]).toEqual(interruptedCall);
  });

  it("blocks a target rotation after an ambiguous provider attempt", async () => {
    await enqueueOutreachInboundForward(
      enqueueDb,
      inboundInput(),
      configuredEnvironment,
    );
    providerResult = {
      data: null,
      error: {
        message: "unknown acceptance",
        statusCode: 500,
        name: "internal_server_error",
      },
    };
    await dispatchDueOutreachInboundForwards(5, configuredEnvironment);
    forwards[0]!.nextAttemptAt = new Date(0);

    const outcomes = await dispatchDueOutreachInboundForwards(5, {
      ...configuredEnvironment,
      OUTREACH_INBOUND_FORWARD_TO: "new-operator@example.test",
    });

    expect(outcomes["configuration-invalid"]).toBe(1);
    expect(providerSend).toHaveBeenCalledTimes(1);
    expect(forwards[0]).toMatchObject({
      status: "PENDING",
      attempts: 1,
      targetAddress: "operator@example.test",
      lastFailureCode: "configuration_target_changed",
    });
  });

  it("bounds target drift by the provider idempotency window", async () => {
    const startedAt = new Date("2026-08-23T10:00:00.000Z");
    setSystemTime(startedAt);
    await enqueueOutreachInboundForward(
      enqueueDb,
      inboundInput(),
      configuredEnvironment,
    );
    providerResult = {
      data: null,
      error: {
        message: "unknown acceptance",
        statusCode: 500,
        name: "internal_server_error",
      },
    };
    await dispatchDueOutreachInboundForwards(5, configuredEnvironment);

    setSystemTime(new Date("2026-08-24T08:59:00.000Z"));
    forwards[0]!.nextAttemptAt = new Date(0);
    const blocked = await dispatchDueOutreachInboundForwards(5, {
      ...configuredEnvironment,
      OUTREACH_INBOUND_FORWARD_TO: "new-operator@example.test",
    });
    expect(blocked["configuration-invalid"]).toBe(1);
    expect(forwards[0]).toMatchObject({
      status: "PENDING",
      attempts: 1,
      targetAddress: "operator@example.test",
      lastFailureCode: "configuration_target_changed",
    });
    expect(alerts).toHaveLength(0);
    expect(providerSend).toHaveBeenCalledTimes(1);

    setSystemTime(new Date("2026-08-24T09:00:00.001Z"));
    forwards[0]!.nextAttemptAt = new Date(0);
    const exhausted = await dispatchDueOutreachInboundForwards(5, {
      ...configuredEnvironment,
      OUTREACH_INBOUND_FORWARD_TO: "new-operator@example.test",
    });
    expect(exhausted.exhausted).toBe(1);
    expect(forwards[0]).toMatchObject({
      status: "EXHAUSTED",
      lastFailureCode: "idempotency_window_expired",
    });
    expect(alerts).toHaveLength(1);
    expect(providerSend).toHaveBeenCalledTimes(1);
  });

  it("terminalizes a permanent participant conflict without calling the provider", async () => {
    setSystemTime(new Date("2026-08-23T10:00:00.000Z"));
    messages.get("inbound_1")!.fromAddress = "operator@example.test";
    await enqueueOutreachInboundForward(
      enqueueDb,
      {
        ...inboundInput(),
        fromAddress: "operator@example.test",
      },
      configuredEnvironment,
    );

    const outcomes = await dispatchDueOutreachInboundForwards(
      5,
      configuredEnvironment,
    );

    expect(outcomes["configuration-invalid"]).toBe(1);
    expect(providerSend).not.toHaveBeenCalled();
    expect(forwards[0]).toMatchObject({
      status: "EXHAUSTED",
      attempts: 0,
      lastFailureCode: "configuration_invalid",
      deliveryLeaseToken: null,
      deliveryLeaseUntil: null,
    });
    expect(alerts).toHaveLength(1);
  });

  it("reconciles a pending ambiguous row when forwarding config is removed", async () => {
    setSystemTime(new Date("2026-08-23T10:00:00.000Z"));
    await enqueueOutreachInboundForward(
      enqueueDb,
      inboundInput(),
      configuredEnvironment,
    );
    providerResult = {
      data: null,
      error: {
        message: "unknown acceptance with private mailbox body",
        statusCode: 500,
        name: "internal_server_error",
      },
    };
    await dispatchDueOutreachInboundForwards(5, configuredEnvironment);
    const sourceBefore = structuredClone(messages.get("inbound_1"));

    setSystemTime(new Date("2026-08-23T10:01:00.000Z"));
    forwards[0]!.nextAttemptAt = new Date(0);
    const outcomes = await dispatchDueOutreachInboundForwards(5, {
      EMAIL_FROM: configuredEnvironment.EMAIL_FROM,
      EMAIL_REPLY_TO: configuredEnvironment.EMAIL_REPLY_TO,
    });

    expect(outcomes["configuration-invalid"]).toBe(1);
    expect(providerSend).toHaveBeenCalledTimes(1);
    expect(forwards[0]).toMatchObject({
      status: "EXHAUSTED",
      attempts: 1,
      lastFailureCode: "configuration_missing",
      deliveryLeaseToken: null,
      deliveryLeaseUntil: null,
    });
    expect(alerts).toHaveLength(1);
    expect(messages.get("inbound_1")).toEqual(sourceBefore);
    expect(JSON.stringify(alerts[0])).not.toContain("private mailbox body");
    expect(JSON.stringify(alerts[0])).not.toContain("operator@example.test");
  });

  it("reconciles an event-first provider receipt without downgrading it", async () => {
    await enqueueOutreachInboundForward(
      enqueueDb,
      inboundInput(),
      configuredEnvironment,
    );
    beforeProviderReturn = () => {
      const eventAt = new Date("2026-08-23T10:01:00.000Z");
      Object.assign(forwards[0]!, {
        status: "SENT",
        sentAt: eventAt,
        deliveryStatus: "DELIVERED",
        providerMessageId: "resend_forward_1",
        providerEventAt: eventAt,
        deliveredAt: eventAt,
        lastFailureCode: null,
        deliveryLeaseToken: null,
        deliveryLeaseUntil: null,
      });
    };

    expect(
      await deliverOutreachInboundForward(
        forwards[0]!.id,
        configuredEnvironment,
      ),
    ).toBe("sent");
    expect(providerSend).toHaveBeenCalledTimes(1);
    expect(forwards[0]).toMatchObject({
      status: "SENT",
      deliveryStatus: "DELIVERED",
      providerMessageId: "resend_forward_1",
      deliveredAt: new Date("2026-08-23T10:01:00.000Z"),
    });
    expect(alerts).toHaveLength(0);
  });

  it("alerts when an event-first provider id conflicts with the send response", async () => {
    await enqueueOutreachInboundForward(
      enqueueDb,
      inboundInput(),
      configuredEnvironment,
    );
    beforeProviderReturn = () => {
      const eventAt = new Date("2026-08-23T10:01:00.000Z");
      Object.assign(forwards[0]!, {
        status: "SENT",
        sentAt: eventAt,
        deliveryStatus: "BOUNCED",
        providerMessageId: "resend_forward_event",
        providerEventAt: eventAt,
        lastFailureCode: null,
        deliveryLeaseToken: null,
        deliveryLeaseUntil: null,
      });
    };

    expect(
      await deliverOutreachInboundForward(
        forwards[0]!.id,
        configuredEnvironment,
      ),
    ).toBe("exhausted");
    expect(providerSend).toHaveBeenCalledTimes(1);
    expect(forwards[0]).toMatchObject({
      status: "SENT",
      deliveryStatus: "BOUNCED",
      providerMessageId: "resend_forward_event",
      lastFailureCode: null,
    });
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({
      context: {
        forwardId: "forward_1",
        outreachMessageId: "inbound_1",
        failureCode: "provider_identity_conflict",
      },
    });
  });

  it("retries only the durable alert boundary after an identity-alert failure", async () => {
    await enqueueOutreachInboundForward(
      enqueueDb,
      inboundInput(),
      configuredEnvironment,
    );
    beforeProviderReturn = () => {
      const eventAt = new Date("2026-08-23T10:01:00.000Z");
      Object.assign(forwards[0]!, {
        status: "SENT",
        sentAt: eventAt,
        deliveryStatus: "BOUNCED",
        providerMessageId: "resend_forward_event",
        providerEventAt: eventAt,
        lastFailureCode: null,
        deliveryLeaseToken: null,
        deliveryLeaseUntil: null,
      });
    };
    failNextOperatorAlert = true;

    expect(
      await deliverOutreachInboundForward(
        forwards[0]!.id,
        configuredEnvironment,
      ),
    ).toBe("pending");
    expect(providerSend).toHaveBeenCalledTimes(1);
    expect(forwards[0]).toMatchObject({
      status: "SENT",
      providerMessageId: "resend_forward_event",
      lastFailureCode: "provider_identity_conflict",
      deliveryLeaseToken: null,
      deliveryLeaseUntil: null,
    });
    expect(alerts).toHaveLength(0);

    beforeProviderReturn = null;
    forwards[0]!.nextAttemptAt = new Date(0);
    expect(
      await deliverOutreachInboundForward(
        forwards[0]!.id,
        configuredEnvironment,
      ),
    ).toBe("exhausted");
    expect(providerSend).toHaveBeenCalledTimes(1);
    expect(forwards[0]).toMatchObject({
      status: "SENT",
      providerMessageId: "resend_forward_event",
      lastFailureCode: null,
    });
    expect(alerts).toHaveLength(1);
  });

  it("reconciles a SENT identity marker after alert persistence recovers", async () => {
    await enqueueOutreachInboundForward(
      enqueueDb,
      inboundInput(),
      configuredEnvironment,
    );
    beforeProviderReturn = () => {
      Object.assign(forwards[0]!, {
        status: "SENT",
        providerMessageId: "resend_forward_event",
        lastFailureCode: null,
      });
    };
    failNextOperatorAlert = true;

    expect(
      await deliverOutreachInboundForward(
        forwards[0]!.id,
        configuredEnvironment,
      ),
    ).toBe("pending");
    expect(providerSend).toHaveBeenCalledTimes(1);
    expect(forwards[0]).toMatchObject({
      status: "SENT",
      providerMessageId: "resend_forward_event",
      lastFailureCode: "provider_identity_conflict",
      deliveryLeaseToken: null,
      deliveryLeaseUntil: null,
    });
    expect(alerts).toHaveLength(0);

    beforeProviderReturn = null;
    forwards[0]!.nextAttemptAt = new Date(0);
    const outcomes = await dispatchDueOutreachInboundForwards(
      5,
      configuredEnvironment,
    );
    expect(outcomes.exhausted).toBe(1);
    expect(providerSend).toHaveBeenCalledTimes(1);
    expect(forwards[0]).toMatchObject({
      status: "SENT",
      providerMessageId: "resend_forward_event",
      lastFailureCode: null,
      deliveryLeaseToken: null,
      deliveryLeaseUntil: null,
    });
    expect(alerts).toHaveLength(1);
  });

  it("terminalizes a unique provider-id bind conflict without resending", async () => {
    await enqueueOutreachInboundForward(
      enqueueDb,
      inboundInput(),
      configuredEnvironment,
    );
    failNextProviderIdentityBind = true;

    expect(
      await deliverOutreachInboundForward(
        forwards[0]!.id,
        configuredEnvironment,
      ),
    ).toBe("exhausted");
    expect(providerSend).toHaveBeenCalledTimes(1);
    expect(forwards[0]).toMatchObject({
      status: "EXHAUSTED",
      providerMessageId: null,
      lastFailureCode: "provider_identity_conflict",
      deliveryLeaseToken: null,
      deliveryLeaseUntil: null,
    });
    expect(alerts).toHaveLength(1);
  });

  it("retries only the alert boundary after a unique provider-id bind conflict", async () => {
    await enqueueOutreachInboundForward(
      enqueueDb,
      inboundInput(),
      configuredEnvironment,
    );
    failNextProviderIdentityBind = true;
    failNextOperatorAlert = true;

    expect(
      await deliverOutreachInboundForward(
        forwards[0]!.id,
        configuredEnvironment,
      ),
    ).toBe("pending");
    expect(providerSend).toHaveBeenCalledTimes(1);
    expect(forwards[0]).toMatchObject({
      status: "PENDING",
      providerMessageId: null,
      lastFailureCode: "provider_identity_conflict",
      deliveryLeaseToken: null,
      deliveryLeaseUntil: null,
    });
    expect(alerts).toHaveLength(0);

    forwards[0]!.nextAttemptAt = new Date(0);
    expect(
      await deliverOutreachInboundForward(
        forwards[0]!.id,
        configuredEnvironment,
      ),
    ).toBe("exhausted");
    expect(providerSend).toHaveBeenCalledTimes(1);
    expect(forwards[0]).toMatchObject({
      status: "EXHAUSTED",
      providerMessageId: null,
      lastFailureCode: "provider_identity_conflict",
    });
    expect(alerts).toHaveLength(1);
  });

  it("does not persist failure state after a successor takes the lease", async () => {
    await enqueueOutreachInboundForward(
      enqueueDb,
      inboundInput(),
      configuredEnvironment,
    );
    providerResult = {
      data: null,
      error: {
        message: "stale worker failure",
        statusCode: 503,
        name: "internal_server_error",
      },
    };
    stealLeaseBeforeFailurePersist = true;

    expect(
      await deliverOutreachInboundForward(
        forwards[0]!.id,
        configuredEnvironment,
      ),
    ).toBe("deduplicated");
    expect(forwards[0]).toMatchObject({
      status: "PENDING",
      deliveryLeaseToken: "successor-worker",
      lastFailureCode: null,
    });
    expect(alerts).toHaveLength(0);
  });

  it("terminalizes prebound identity evidence without a durable provider attempt", async () => {
    for (const [index, attemptEvidence] of [
      { attempts: 0, firstProviderAttemptAt: new Date() },
      { attempts: 1, firstProviderAttemptAt: null },
    ].entries()) {
      await enqueueOutreachInboundForward(
        enqueueDb,
        inboundInput({ outreachMessageId: `inbound_invalid_${index}` }),
        configuredEnvironment,
      );
      const forward = forwards[index]!;
      Object.assign(forward, {
        attempts: attemptEvidence.attempts,
        firstProviderAttemptAt: attemptEvidence.firstProviderAttemptAt,
        providerMessageId: `invalid_prebound_${index}`,
        providerEventAt: new Date(),
      });

      expect(
        await deliverOutreachInboundForward(
          forward.id,
          configuredEnvironment,
        ),
      ).toBe("exhausted");
      expect(forward).toMatchObject({
        status: "EXHAUSTED",
        lastFailureCode: "provider_identity_without_attempt_evidence",
        deliveryLeaseToken: null,
        deliveryLeaseUntil: null,
      });
    }
    expect(providerSend).not.toHaveBeenCalled();
    expect(alerts).toHaveLength(2);
  });

  it("does not alert exhaustion after another worker finalizes the row", async () => {
    await enqueueOutreachInboundForward(
      enqueueDb,
      inboundInput(),
      configuredEnvironment,
    );
    providerResult = {
      data: null,
      error: {
        message: "definitive stale rejection",
        statusCode: 422,
        name: "validation_error",
      },
    };
    finalizeElsewhereBeforeExhaust = true;

    expect(
      await deliverOutreachInboundForward(
        forwards[0]!.id,
        configuredEnvironment,
      ),
    ).toBe("deduplicated");
    expect(forwards[0]).toMatchObject({
      status: "SENT",
      deliveryLeaseToken: null,
    });
    expect(alerts).toHaveLength(0);
  });

  it("exhausts bounded failures and alerts without mailbox content", async () => {
    await enqueueOutreachInboundForward(
      enqueueDb,
      inboundInput(),
      configuredEnvironment,
    );
    providerResult = {
      data: null,
      error: {
        message: "provider payload contains the private reply body",
        statusCode: 503,
        name: "internal_server_error",
      },
    };

    for (let attempt = 0; attempt < 3; attempt += 1) {
      await dispatchDueOutreachInboundForwards(5, configuredEnvironment);
      forwards[0]!.nextAttemptAt = new Date(0);
    }

    expect(forwards[0]).toMatchObject({
      status: "EXHAUSTED",
      attempts: 3,
      lastFailureCode: "provider_unavailable",
    });
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({
      kind: "OUTREACH_SEND_FAILURE",
      createdInsideTransaction: true,
      context: {
        forwardId: "forward_1",
        outreachMessageId: "inbound_1",
        failureCode: "provider_unavailable",
      },
    });
    const serializedAlert = JSON.stringify(alerts[0]);
    expect(serializedAlert).not.toContain("private reply body");
    expect(serializedAlert).not.toContain("operator@example.test");
    expect(serializedAlert).not.toContain("Looks great");
  });

  it("treats a changed idempotent payload response as terminal", async () => {
    await enqueueOutreachInboundForward(
      enqueueDb,
      inboundInput(),
      configuredEnvironment,
    );
    providerResult = {
      data: null,
      error: {
        message: "payload changed",
        statusCode: 409,
        name: "invalid_idempotent_request",
      },
    };

    const outcomes = await dispatchDueOutreachInboundForwards(
      5,
      configuredEnvironment,
    );
    expect(outcomes.exhausted).toBe(1);
    expect(forwards[0]).toMatchObject({
      status: "EXHAUSTED",
      attempts: 1,
      lastFailureCode: "idempotency_payload_mismatch",
    });
  });

  it("exhausts an ambiguous attempt outside the provider idempotency window", async () => {
    await enqueueOutreachInboundForward(
      enqueueDb,
      inboundInput(),
      configuredEnvironment,
    );
    Object.assign(forwards[0]!, {
      attempts: 1,
      targetAddress: "operator@example.test",
      firstProviderAttemptAt: new Date(Date.now() - 24 * 60 * 60_000),
    });

    expect(
      await deliverOutreachInboundForward(
        forwards[0]!.id,
        configuredEnvironment,
      ),
    ).toBe("exhausted");
    expect(providerSend).not.toHaveBeenCalled();
    expect(forwards[0]).toMatchObject({
      status: "EXHAUSTED",
      lastFailureCode: "idempotency_window_expired",
    });
  });

  it("continues past an unsafe poison row to send the next due copy", async () => {
    messages.set("inbound_poison", {
      fromAddress: "operator@example.test",
      toAddress: "vincent@restofront.com",
      subject: "Unsafe fixture",
      textBody: "Must not be sent back to its source.",
    });
    sites.set("site_2", { name: "Second lead", slug: "second-lead" });
    messages.set("inbound_2", {
      fromAddress: "owner@second-lead.test",
      toAddress: "vincent@restofront.com",
      subject: "Safe fixture",
      textBody: "Please call tomorrow.",
    });
    await enqueueOutreachInboundForward(
      enqueueDb,
      {
        outreachMessageId: "inbound_poison",
        siteId: "site_1",
        fromAddress: "operator@example.test",
        toAddress: "vincent@restofront.com",
      },
      configuredEnvironment,
    );
    await enqueueOutreachInboundForward(
      enqueueDb,
      {
        outreachMessageId: "inbound_2",
        siteId: "site_2",
        fromAddress: "owner@second-lead.test",
        toAddress: "vincent@restofront.com",
      },
      configuredEnvironment,
    );

    const outcomes = await dispatchDueOutreachInboundForwards(
      5,
      configuredEnvironment,
    );
    expect(outcomes["configuration-invalid"]).toBe(1);
    expect(outcomes.sent).toBe(1);
    expect(providerSend).toHaveBeenCalledTimes(1);
    expect(providerSend.mock.calls[0]?.[0]).toMatchObject({
      subject: expect.stringContaining("Second lead"),
    });
  });
});

function inboundInput(
  overrides: Partial<{
    outreachMessageId: string;
    siteId: string;
    fromAddress: string;
    toAddress: string;
  }> = {},
) {
  return {
    outreachMessageId: "inbound_1",
    siteId: "site_1",
    fromAddress: "owner@chez-lea.test",
    toAddress: "vincent@restofront.com",
    ...overrides,
  };
}

function matchesWhere(
  forward: ForwardRow,
  where: Record<string, unknown>,
): boolean {
  return Object.entries(where).every(([key, expected]) => {
    if (key === "OR") {
      return (expected as Array<Record<string, unknown>>).some((clause) =>
        matchesWhere(forward, clause),
      );
    }
    if (key === "NOT") {
      return !matchesWhere(forward, expected as Record<string, unknown>);
    }
    const actual = forward[key];
    if (expected && typeof expected === "object" && !(expected instanceof Date)) {
      const comparison = expected as {
        gt?: number;
        lt?: number | Date;
        lte?: number | Date;
        not?: unknown;
      };
      if (comparison.not !== undefined) return actual !== comparison.not;
      if (comparison.gt !== undefined) {
        return typeof actual === "number" && actual > comparison.gt;
      }
      if (comparison.lt !== undefined) {
        return comparison.lt instanceof Date
          ? actual instanceof Date && actual < comparison.lt
          : typeof actual === "number" && actual < comparison.lt;
      }
      if (comparison.lte !== undefined) {
        return comparison.lte instanceof Date
          ? actual instanceof Date && actual <= comparison.lte
          : typeof actual === "number" && actual <= comparison.lte;
      }
    }
    return actual === expected;
  });
}

function applyData(forward: ForwardRow, data: Record<string, unknown>) {
  for (const [key, value] of Object.entries(data)) {
    if (
      key === "attempts" &&
      value &&
      typeof value === "object" &&
      "increment" in value
    ) {
      forward.attempts += Number((value as { increment: number }).increment);
    } else {
      forward[key] = value;
    }
  }
}
