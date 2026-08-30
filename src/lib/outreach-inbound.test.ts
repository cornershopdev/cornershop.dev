import { afterAll, beforeEach, describe, expect, it, mock } from "bun:test";

mock.module("server-only", () => ({}));

const alerts: Array<Record<string, unknown>> = [];
const auditEvents: Array<Record<string, unknown>> = [];
const messages: Array<Record<string, unknown>> = [];
const forwards: Array<Record<string, unknown>> = [];
let transactionDepth = 0;
let hideExistingInboundOutsideTransaction = false;
const sites = [
  {
    id: "site_1",
    name: "Chez Léa",
    slug: "chez-lea",
    email: "bonjour@chez-lea.test",
    leadContactEmail: "owner@chez-lea.test",
    vertical: "RESTAURANT",
    updatedAt: new Date("2026-08-19T08:00:00.000Z"),
  },
];

const fetchReceived = mock(
  async (): Promise<{
    id: string;
    from: string;
    to: string[];
    subject: string;
    text: string | null;
    html: string | null;
    messageId: string | null;
    receivedFor: string[];
    headers: Record<string, string>;
  } | null> => ({
    id: "recv_1",
    from: "owner@chez-lea.test",
    to: ["vincent@reply.restofront.com"],
    subject: "Re: Chez Léa, your new site is ready to preview",
    text: "Looks great — can we talk?",
    html: "<p>Looks great — can we talk?</p>",
    messageId: "<reply@chez-lea.test>",
    receivedFor: ["vincent@reply.restofront.com"],
    headers: {
      "in-reply-to": "<outreach_abc@send.restofront.com>",
      references: "<outreach_abc@send.restofront.com>",
    },
  }),
);

mock.module("@/lib/resend-receiving", () => ({
  fetchReceivedResendEmail: fetchReceived,
}));
mock.module("@/lib/operator-alerts", () => ({
  captureOperatorAlert: async (input: Record<string, unknown>) => {
    alerts.push(input);
    return "delivered" as const;
  },
}));
mock.module("@/lib/db", () => ({
  getDb: () => fakeDb,
}));

const fakeDb = {
  $queryRaw: async () => [],
  $executeRaw: async () => 0,
  $transaction: async (callback: (transaction: object) => unknown) => {
    transactionDepth += 1;
    try {
      return await callback(fakeDb);
    } finally {
      transactionDepth -= 1;
    }
  },
  outreachMessage: {
    findUnique: async (input: {
      where: { providerMessageId?: string; rfcMessageId?: string };
    }) => {
      const found = messages.find(
        (message) =>
          (input.where.providerMessageId &&
            message.providerMessageId === input.where.providerMessageId) ||
          (input.where.rfcMessageId &&
            message.rfcMessageId === input.where.rfcMessageId),
      ) ?? null;
      if (
        hideExistingInboundOutsideTransaction &&
        transactionDepth === 0 &&
        found?.direction === "INBOUND"
      ) {
        return null;
      }
      return found;
    },
    findFirst: async (input: {
      where: {
        OR?: Array<Record<string, unknown>>;
        siteId?: string;
        direction?: string;
      };
    }) => {
      if (input.where.OR) {
        return (
          messages.find((message) =>
            input.where.OR?.some((clause) =>
              Object.entries(clause).every(([key, value]) => {
                if (
                  value &&
                  typeof value === "object" &&
                  "in" in value &&
                  Array.isArray((value as { in: unknown[] }).in)
                ) {
                  return (value as { in: unknown[] }).in.includes(message[key]);
                }
                return message[key] === value;
              }),
            ),
          ) ?? null
        );
      }
      return (
        messages.find(
          (message) =>
            (!input.where.siteId || message.siteId === input.where.siteId) &&
            (!input.where.direction ||
              message.direction === input.where.direction),
        ) ?? null
      );
    },
    create: async (input: { data: Record<string, unknown> }) => {
      const created = { id: "inbound_1", ...input.data };
      messages.push(created);
      return created;
    },
  },
  site: {
    findUniqueOrThrow: async (input: { where: { id: string } }) => {
      const site = sites.find((candidate) => candidate.id === input.where.id);
      if (!site) throw new Error("fixture site missing");
      return site;
    },
    findFirst: async (input: {
      where: {
        leadContactEmail?: string;
        slug?: { in: string[] };
        vertical?: string | { in: string[] };
      };
    }) => {
      return (
        sites.find((site) => {
          if (
            typeof input.where.vertical === "string" &&
            site.vertical !== input.where.vertical
          ) {
            return false;
          }
          if (
            typeof input.where.vertical === "object" &&
            !input.where.vertical.in.includes(site.vertical)
          )
            return false;
          if (
            input.where.leadContactEmail &&
            site.leadContactEmail !== input.where.leadContactEmail
          ) {
            return false;
          }
          if (
            input.where.slug?.in &&
            !input.where.slug.in.includes(site.slug)
          ) {
            return false;
          }
          return true;
        }) ?? null
      );
    },
    findMany: async (input: {
      where: {
        leadContactEmail?: string;
        vertical?: { in: string[] };
      };
      take: number;
    }) =>
      sites
        .filter(
          (site) =>
            (!input.where.leadContactEmail ||
              site.leadContactEmail === input.where.leadContactEmail) &&
            (!input.where.vertical ||
              input.where.vertical.in.includes(site.vertical)),
        )
        .slice(0, input.take),
  },
  auditEvent: {
    create: async (input: { data: Record<string, unknown> }) => {
      auditEvents.push(input.data);
      return input.data;
    },
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
      const created = {
        id: `forward_${forwards.length + 1}`,
        attempts: 0,
        targetAddress: null,
        status: "PENDING",
        createdInsideTransaction: transactionDepth > 0,
        ...input.create,
      };
      forwards.push(created);
      return created;
    },
    updateMany: async (input: {
      where: { id: string; targetAddress?: null };
      data: Record<string, unknown>;
    }) => {
      const forward = forwards.find(
        (candidate) =>
          candidate.id === input.where.id &&
          (input.where.targetAddress !== null ||
            candidate.targetAddress === null),
      );
      if (!forward) return { count: 0 };
      Object.assign(forward, input.data);
      return { count: 1 };
    },
  },
};

const { recordInboundOutreachMessage } = await import("@/lib/outreach-inbound");
const previousForwardTarget = process.env.OUTREACH_INBOUND_FORWARD_TO;

describe("inbound outreach mailbox", () => {
  beforeEach(() => {
    alerts.length = 0;
    auditEvents.length = 0;
    messages.length = 0;
    forwards.length = 0;
    transactionDepth = 0;
    hideExistingInboundOutsideTransaction = false;
    delete process.env.OUTREACH_INBOUND_FORWARD_TO;
    fetchReceived.mockClear();
    messages.push({
      id: "outreach_abc",
      siteId: "site_1",
      direction: "OUTBOUND",
      rfcMessageId: "outreach_abc@send.restofront.com",
      providerMessageId: "resend_message_1",
      threadKey: "lead:site_1",
    });
  });

  afterAll(() => {
    if (previousForwardTarget === undefined) {
      delete process.env.OUTREACH_INBOUND_FORWARD_TO;
    } else {
      process.env.OUTREACH_INBOUND_FORWARD_TO = previousForwardTarget;
    }
  });

  it("matches In-Reply-To, stores RECEIVED mail, and alerts the operator", async () => {
    const result = await recordInboundOutreachMessage({
      eventId: "svix_1",
      occurredAt: new Date("2026-08-19T09:00:00.000Z"),
      metadata: {
        emailId: "recv_1",
        from: "owner@chez-lea.test",
        to: ["vincent@reply.restofront.com"],
        subject: "Re: preview",
        rfcMessageId: "<reply@chez-lea.test>",
        receivedFor: ["vincent@reply.restofront.com"],
      },
    });

    expect(result).toEqual({
      handled: true,
      created: true,
      retry: false,
      siteId: "site_1",
      messageId: "inbound_1",
    });
    expect(messages.at(-1)).toMatchObject({
      direction: "INBOUND",
      status: "RECEIVED",
      threadKey: "lead:site_1",
      textBody: "Looks great — can we talk?",
    });
    expect(auditEvents.map((event) => event.type)).toEqual([
      "outreach.inbound.received",
    ]);
    expect(alerts[0]).toMatchObject({ kind: "OUTREACH_REPLY" });
    expect(forwards).toHaveLength(0);
  });

  it("commits one forward intent atomically with the inbound mailbox row", async () => {
    process.env.OUTREACH_INBOUND_FORWARD_TO = " Operator@Example.test ";

    const result = await recordInboundOutreachMessage({
      eventId: "svix_forward",
      occurredAt: new Date("2026-08-19T09:00:00.000Z"),
      metadata: {
        emailId: "recv_1",
        from: "owner@chez-lea.test",
        to: ["vincent@reply.restofront.com"],
        subject: "Re: preview",
        rfcMessageId: "<reply@chez-lea.test>",
        receivedFor: ["vincent@reply.restofront.com"],
      },
    });

    expect(result).toMatchObject({ handled: true, created: true });
    expect(forwards).toEqual([
      expect.objectContaining({
        outreachMessageId: "inbound_1",
        idempotencyKey: "outreach-inbound-forward:inbound_1",
        targetAddress: "operator@example.test",
        siteName: "Chez Léa",
        siteSlug: "chez-lea",
        createdInsideTransaction: true,
      }),
    ]);
  });

  it("persists ingestion and a blocked intent when the configured target is unsafe", async () => {
    process.env.OUTREACH_INBOUND_FORWARD_TO =
      "vincent+loop@reply.restofront.com";

    const result = await recordInboundOutreachMessage({
      eventId: "svix_unsafe_forward",
      occurredAt: new Date("2026-08-19T09:00:00.000Z"),
      metadata: {
        emailId: "recv_1",
        from: "owner@chez-lea.test",
        to: ["vincent@reply.restofront.com"],
        subject: "Re: preview",
        rfcMessageId: "<reply@chez-lea.test>",
        receivedFor: ["vincent@reply.restofront.com"],
      },
    });

    expect(result).toMatchObject({ handled: true, created: true });
    expect(messages.at(-1)).toMatchObject({ direction: "INBOUND" });
    expect(forwards[0]).toMatchObject({
      targetAddress: null,
      lastFailureCode: "configuration_invalid",
      createdInsideTransaction: true,
    });
  });

  it("matches a headerless reply only by the private lead recipient", async () => {
    fetchReceived.mockResolvedValueOnce({
      id: "recv_headerless",
      from: "owner@chez-lea.test",
      to: ["vincent@reply.restofront.com"],
      subject: "Re: preview",
      text: "Following up without reply headers",
      html: null,
      messageId: "<headerless@chez-lea.test>",
      receivedFor: ["vincent@reply.restofront.com"],
      headers: {},
    });

    const result = await recordInboundOutreachMessage({
      eventId: "svix_headerless",
      occurredAt: new Date("2026-08-19T09:05:00.000Z"),
      metadata: {
        emailId: "recv_headerless",
        from: "owner@chez-lea.test",
        to: ["vincent@reply.restofront.com"],
        subject: "Re: preview",
        rfcMessageId: "<headerless@chez-lea.test>",
        receivedFor: ["vincent@reply.restofront.com"],
      },
    });

    expect(result).toMatchObject({
      handled: true,
      created: true,
      siteId: "site_1",
    });
    expect(messages.at(-1)).toMatchObject({
      fromAddress: "owner@chez-lea.test",
      siteId: "site_1",
      threadKey: "lead:site_1",
    });

    fetchReceived.mockResolvedValueOnce({
      id: "recv_public",
      from: "bonjour@chez-lea.test",
      to: ["vincent@reply.restofront.com"],
      subject: "Unrelated public-address mail",
      text: "This address must not identify the private lead thread.",
      html: null,
      messageId: "<public-address@chez-lea.test>",
      receivedFor: ["vincent@reply.restofront.com"],
      headers: {},
    });

    const publicResult = await recordInboundOutreachMessage({
      eventId: "svix_public",
      occurredAt: new Date("2026-08-19T09:06:00.000Z"),
      metadata: {
        emailId: "recv_public",
        from: "bonjour@chez-lea.test",
        to: ["vincent@reply.restofront.com"],
        subject: "Unrelated public-address mail",
        rfcMessageId: "<public-address@chez-lea.test>",
        receivedFor: ["vincent@reply.restofront.com"],
      },
    });

    expect(publicResult).toEqual({
      handled: false,
      created: false,
      retry: false,
      siteId: null,
      messageId: null,
    });
  });

  it("is idempotent on the provider receiving id", async () => {
    process.env.OUTREACH_INBOUND_FORWARD_TO = "operator@example.test";
    messages.push({
      id: "inbound_existing",
      siteId: "site_1",
      providerMessageId: "recv_1",
      fromAddress: "owner@chez-lea.test",
      toAddress: "vincent@reply.restofront.com",
    });
    const result = await recordInboundOutreachMessage({
      eventId: "svix_1",
      occurredAt: new Date("2026-08-19T09:00:00.000Z"),
      metadata: {
        emailId: "recv_1",
        from: "owner@chez-lea.test",
        to: ["vincent@reply.restofront.com"],
        subject: "Re: preview",
        rfcMessageId: "<reply@chez-lea.test>",
        receivedFor: [],
      },
    });

    expect(result).toEqual({
      handled: true,
      created: false,
      retry: false,
      siteId: "site_1",
      messageId: "inbound_existing",
    });
    expect(fetchReceived).not.toHaveBeenCalled();
    expect(forwards).toHaveLength(1);
    expect(forwards[0]).toMatchObject({
      outreachMessageId: "inbound_existing",
      targetAddress: "operator@example.test",
    });
  });

  it("repairs a missing intent when the duplicate appears inside the transaction", async () => {
    process.env.OUTREACH_INBOUND_FORWARD_TO = "operator@example.test";
    messages.push({
      id: "inbound_racing",
      siteId: "site_1",
      direction: "INBOUND",
      providerMessageId: "recv_1",
      fromAddress: "owner@chez-lea.test",
      toAddress: "vincent@reply.restofront.com",
    });
    hideExistingInboundOutsideTransaction = true;

    const result = await recordInboundOutreachMessage({
      eventId: "svix_race",
      occurredAt: new Date("2026-08-19T09:00:00.000Z"),
      metadata: {
        emailId: "recv_1",
        from: "owner@chez-lea.test",
        to: ["vincent@reply.restofront.com"],
        subject: "Re: preview",
        rfcMessageId: "<reply@chez-lea.test>",
        receivedFor: [],
      },
    });

    expect(result).toMatchObject({
      handled: true,
      created: false,
      messageId: "inbound_racing",
    });
    expect(forwards).toEqual([
      expect.objectContaining({
        outreachMessageId: "inbound_racing",
        targetAddress: "operator@example.test",
        createdInsideTransaction: true,
      }),
    ]);
  });

  it("retries when Resend has not published the received body yet", async () => {
    fetchReceived.mockResolvedValueOnce(null);
    const result = await recordInboundOutreachMessage({
      eventId: "svix_1",
      occurredAt: new Date("2026-08-19T09:00:00.000Z"),
      metadata: {
        emailId: "recv_missing",
        from: "owner@chez-lea.test",
        to: ["vincent@reply.restofront.com"],
        subject: "Re: preview",
        rfcMessageId: null,
        receivedFor: [],
      },
    });

    expect(result.retry).toBe(true);
    expect(result.handled).toBe(false);
  });
});
