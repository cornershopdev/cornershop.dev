import { beforeEach, describe, expect, it, mock } from "bun:test";
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
  targetAddress: string | null;
  createdAt: Date;
};

const forwards: ForwardRow[] = [];
const messages = new Map<string, Record<string, unknown>>();
const sites = new Map<string, { name: string; slug: string }>();
const alerts: Array<Record<string, unknown>> = [];
let transactionDepth = 0;
let nextForwardId = 1;
let failNextSentFinalize = false;
let failNextFailurePersist = false;
let stealLeaseBeforeFailurePersist = false;
let finalizeElsewhereBeforeExhaust = false;
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
    return providerResult;
  },
);

const fakeDb = {
  $transaction: async (callback: (transaction: object) => unknown) => {
    transactionDepth += 1;
    try {
      return await callback(fakeDb);
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
        targetAddress: null,
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
    _db: unknown,
    input: Record<string, unknown>,
  ) => {
    void _db;
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
  EMAIL_REPLY_TO: "vincent@reply.cornershop.dev",
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
    failNextFailurePersist = false;
    stealLeaseBeforeFailurePersist = false;
    finalizeElsewhereBeforeExhaust = false;
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

  it("creates no intent when forwarding is absent and one stable intent when enabled", async () => {
    expect(
      await enqueueOutreachInboundForward(
        enqueueDb,
        inboundInput(),
        { EMAIL_REPLY_TO: "vincent@reply.cornershop.dev" },
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
      lastFailureCode: "configuration_invalid",
    });
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

function inboundInput() {
  return {
    outreachMessageId: "inbound_1",
    siteId: "site_1",
    fromAddress: "owner@chez-lea.test",
    toAddress: "vincent@restofront.com",
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
    const actual = forward[key];
    if (expected && typeof expected === "object" && !(expected instanceof Date)) {
      const comparison = expected as {
        lt?: number | Date;
        lte?: number | Date;
      };
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
