import { describe, expect, it, mock } from "bun:test";

mock.module("server-only", () => ({}));

type FakeMessage = {
  id: string;
  direction: "OUTBOUND" | "INBOUND";
  status: string;
  provider: string;
  siteId: string;
  fromAddress: string | null;
  toAddress: string | null;
  subject: string | null;
  template: string | null;
  error: string | null;
  sentAt: Date | null;
  receivedAt: Date | null;
  createdAt: Date;
  site: { name: string; slug: string } | null;
  inboundForward: {
    status: string;
    deliveryStatus: string;
    attempts: number;
    lastFailureCode: string | null;
    deliveryFailureCode: string | null;
  } | null;
};

type FakeDispatch = {
  id: string;
  siteId: string;
  template: string;
  recipient: string;
  status: string;
  attempt: number;
  reviewedAt: Date | null;
  requestedBy: string | null;
  error: string | null;
  createdAt: Date;
  updatedAt: Date;
  site: {
    name: string;
    slug: string;
    outreachMessages: Array<{ id: string }>;
  } | null;
};

function message(overrides: Partial<FakeMessage> = {}): FakeMessage {
  return {
    id: "msg-1",
    direction: "OUTBOUND",
    status: "SENT",
    provider: "resend",
    siteId: "site-1",
    fromAddress: "outreach@send.cornershop.dev",
    toAddress: "owner@trattoria.mt",
    subject: "Your preview is ready",
    template: "preview_ready",
    error: null,
    sentAt: new Date("2026-08-20T10:00:00.000Z"),
    receivedAt: null,
    createdAt: new Date("2026-08-20T09:00:00.000Z"),
    site: { name: "Trattoria Vera", slug: "trattoria-vera" },
    inboundForward: null,
    ...overrides,
  };
}

function dispatch(overrides: Partial<FakeDispatch> = {}): FakeDispatch {
  return {
    id: "dispatch-1",
    siteId: "site-1",
    template: "preview_ready",
    recipient: "owner@trattoria.mt",
    status: "SENT",
    attempt: 1,
    reviewedAt: new Date("2026-08-19T08:00:00.000Z"),
    requestedBy: "operator@cornershop.dev",
    error: null,
    createdAt: new Date("2026-08-19T09:00:00.000Z"),
    updatedAt: new Date("2026-08-20T10:00:00.000Z"),
    site: {
      name: "Trattoria Vera",
      slug: "trattoria-vera",
      outreachMessages: [],
    },
    ...overrides,
  };
}

type FakeCounts = {
  sends: number;
  replies: number;
  sequences: number;
  failedMessages: number;
  stalledForwards: number;
};

async function loadInbox(options: {
  messages?: FakeMessage[];
  dispatches?: FakeDispatch[];
  counts?: Partial<FakeCounts>;
  pauseSettings?: Array<{ key: string; value: unknown }>;
}) {
  const counts: FakeCounts = {
    sends: 1,
    replies: 0,
    sequences: 1,
    failedMessages: 0,
    stalledForwards: 0,
    ...options.counts,
  };

  const fakeDb = {
    outreachMessage: {
      findMany: async () => options.messages ?? [],
      count: async ({
        where,
      }: {
        where?: { direction?: string; status?: unknown };
      } = {}) => {
        if (where?.direction === "OUTBOUND") return counts.sends;
        if (where?.direction === "INBOUND") return counts.replies;
        return counts.failedMessages;
      },
    },
    outreachDispatch: {
      findMany: async () => options.dispatches ?? [],
      count: async () => counts.sequences,
    },
    outreachInboundForward: {
      count: async () => counts.stalledForwards,
    },
    operatorSetting: {
      findMany: async () => options.pauseSettings ?? [],
    },
  };

  mock.module("@/lib/db", () => ({ getDb: () => fakeDb }));
  const { getOutreachInbox } = await import("@/lib/outreach-inbox");
  return getOutreachInbox();
}

describe("getOutreachInbox", () => {
  it("masks the counterparty per direction and never leaks a raw address", async () => {
    const result = await loadInbox({
      messages: [
        message({ id: "out-1", direction: "OUTBOUND" }),
        message({
          id: "in-1",
          direction: "INBOUND",
          status: "RECEIVED",
          fromAddress: "chef@osteria.mt",
          toAddress: "outreach@send.cornershop.dev",
          sentAt: null,
          receivedAt: new Date("2026-08-21T11:00:00.000Z"),
        }),
      ],
      dispatches: [dispatch()],
    });

    expect(result.messages[0].counterparty).toBe("o****@trattoria.mt");
    expect(result.messages[1].counterparty).toBe("c***@osteria.mt");
    expect(result.sequences[0].recipient).toBe("o****@trattoria.mt");

    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain("owner@trattoria.mt");
    expect(serialized).not.toContain("chef@osteria.mt");
  });

  it("falls back through sentAt, receivedAt, then createdAt for occurredAt", async () => {
    const result = await loadInbox({
      messages: [
        message({ id: "a", sentAt: new Date("2026-08-20T10:00:00.000Z") }),
        message({
          id: "b",
          sentAt: null,
          receivedAt: new Date("2026-08-21T11:00:00.000Z"),
        }),
        message({ id: "c", sentAt: null, receivedAt: null }),
      ],
    });

    expect(result.messages[0].occurredAt).toBe("2026-08-20T10:00:00.000Z");
    expect(result.messages[1].occurredAt).toBe("2026-08-21T11:00:00.000Z");
    expect(result.messages[2].occurredAt).toBe("2026-08-20T09:00:00.000Z");
  });

  it("surfaces a failing inbound forward on the reply row", async () => {
    const result = await loadInbox({
      messages: [
        message({
          direction: "INBOUND",
          status: "RECEIVED",
          inboundForward: {
            status: "EXHAUSTED",
            deliveryStatus: "BOUNCED",
            attempts: 3,
            lastFailureCode: "smtp_550",
            deliveryFailureCode: "hard_bounce",
          },
        }),
      ],
    });

    expect(result.messages[0].forward).toEqual({
      status: "EXHAUSTED",
      deliveryStatus: "BOUNCED",
      attempts: 3,
      lastFailureCode: "smtp_550",
      deliveryFailureCode: "hard_bounce",
    });
  });

  it("reports truncation only when totals exceed the returned rows", async () => {
    const truncated = await loadInbox({
      messages: [message()],
      dispatches: [dispatch()],
      counts: { sends: 400, replies: 120, sequences: 90 },
    });
    expect(truncated.messagesTruncated).toBe(true);
    expect(truncated.sequencesTruncated).toBe(true);

    const complete = await loadInbox({
      messages: [message()],
      dispatches: [dispatch()],
      counts: { sends: 1, replies: 0, sequences: 1 },
    });
    expect(complete.messagesTruncated).toBe(false);
    expect(complete.sequencesTruncated).toBe(false);
  });

  it("takes counts from count queries, not from the capped row arrays", async () => {
    const result = await loadInbox({
      messages: [message()],
      dispatches: [dispatch()],
      counts: {
        sends: 812,
        replies: 47,
        sequences: 233,
        failedMessages: 9,
        stalledForwards: 4,
      },
    });

    expect(result.counts).toEqual({
      sends: 812,
      replies: 47,
      sequences: 233,
      failedMessages: 9,
      stalledForwards: 4,
    });
    expect(result.messages).toHaveLength(1);
    expect(result.sequences).toHaveLength(1);
  });

  it("surfaces per-lead pauses and inbound stops on dispatch sequences", async () => {
    const result = await loadInbox({
      dispatches: [
        dispatch({
          id: "guarded",
          site: {
            name: "Trattoria Vera",
            slug: "trattoria-vera",
            outreachMessages: [{ id: "reply-1" }],
          },
        }),
        dispatch({
          id: "active",
          siteId: "site-2",
          site: {
            name: "Osteria Luna",
            slug: "osteria-luna",
            outreachMessages: [],
          },
        }),
      ],
      pauseSettings: [
        { key: "outreach.paused.site.site-1", value: true },
        { key: "outreach.paused.site.site-2", value: false },
      ],
    });

    expect(result.sequences[0]).toMatchObject({
      pauseScope: "lead",
      inboundStopped: true,
    });
    expect(result.sequences[1]).toMatchObject({
      pauseScope: null,
      inboundStopped: false,
    });
  });

  it("shows the global pause on every dispatch sequence", async () => {
    const result = await loadInbox({
      dispatches: [dispatch()],
      pauseSettings: [{ key: "outreach.paused", value: true }],
    });

    expect(result.sequences[0].pauseScope).toBe("global");
  });

  it("stays listing-only: no send path, no server action, no message bodies", async () => {
    const source = await Bun.file("src/lib/outreach-inbox.ts").text();
    const pageSource = await Bun.file("src/app/admin/inbox/page.tsx").text();
    const adminSource = await Bun.file("src/app/admin/page.tsx").text();

    expect(source).not.toContain("use server");
    expect(source).not.toContain("resend");
    expect(source).not.toContain("Resend");
    expect(source).not.toContain("sendLeadEmail");
    expect(source).not.toContain("sendOperatorReply");
    expect(source).not.toContain("deliverOutreachInboundForward");
    expect(source).not.toContain("textBody");
    expect(source).not.toContain("htmlBody");
    expect(pageSource).not.toContain("<form");
    expect(pageSource).not.toContain("sendLeadEmail");
    expect(pageSource).not.toContain("sendOperatorReply");
    expect(pageSource).not.toContain("textBody");
    expect(pageSource).not.toContain("htmlBody");
    expect(pageSource).toContain('href={`/admin#outreach-${siteSlug}`}');
    expect(adminSource).toContain('id={`outreach-${site.slug}`}');
  });
});
