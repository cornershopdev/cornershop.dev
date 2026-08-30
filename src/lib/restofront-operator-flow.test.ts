import { beforeEach, describe, expect, it, mock } from "bun:test";
import {
  outreachReadinessTestModule,
  rateLimitTestModule,
} from "@/lib/complete-test-module-mocks";

mock.module("server-only", () => ({}));
process.env.OUTREACH_LEGAL_CONTROLLER = "Corner Shop Labs Ltd";

type AuditEvent = {
  id: string;
  type: string;
  actor: string | null;
  metadata: Record<string, unknown>;
  siteId: string | null;
  createdAt: Date;
};

type Dispatch = {
  id: string;
  idempotencyKey: string;
  siteId: string;
  template: "preview_ready";
  recipient: string;
  reviewedAt: Date;
  requestedBy: string;
  status: "QUEUED" | "SENT" | "FAILED";
  workflowRunId: string | null;
  error: string | null;
  attempt: number;
  createdAt: Date;
  updatedAt: Date;
};

type MessageStatus =
  | "QUEUED"
  | "SENT"
  | "DELIVERED"
  | "BOUNCED"
  | "COMPLAINED"
  | "FAILED"
  | "RECEIVED";

type OutreachMessage = {
  id: string;
  idempotencyKey: string;
  siteId: string;
  direction: "OUTBOUND" | "INBOUND";
  provider: string;
  providerMessageId: string | null;
  rfcMessageId: string | null;
  providerEventAt: Date | null;
  providerAttemptedAt: Date | null;
  deliveryLeaseId: string | null;
  deliveryLeaseExpiresAt: Date | null;
  fromAddress: string;
  replyToAddress: string | null;
  toAddress: string;
  subject: string;
  textBody: string;
  htmlBody: string | null;
  template: string | null;
  inReplyTo: string | null;
  threadKey: string | null;
  createdByActor: string | null;
  status: MessageStatus;
  error: string | null;
  sentAt: Date | null;
  deliveredAt: Date | null;
  receivedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

type ClaimInvitation = {
  id: string;
  siteId: string;
  email: string;
  tokenHash: string;
  outreachKey: string | null;
  proofMethod: string;
  approvalEvidenceRef: string | null;
  approvedBy: string | null;
  approvedAt: Date | null;
  expiresAt: Date;
  verifiedAt: Date | null;
  acceptedAt: Date | null;
  revokedAt: Date | null;
  checkoutSessionId: string | null;
};

const auditEvents: AuditEvent[] = [];
const operatorAuditEvents: Array<Record<string, unknown>> = [];
const providerEvents = new Map<string, Record<string, unknown>>();
let clock = new Date("2026-08-19T08:00:00.000Z").getTime();
let dispatch: Dispatch | null = null;
let message: OutreachMessage | null = null;
let invitation: ClaimInvitation | null = null;
let paused = false;

const site = {
  id: "site_1",
  sourceKey: "url:chez-lea.test",
  slug: "chez-lea",
  name: "Chez Léa",
  vertical: "RESTAURANT" as const,
  sourceUrl: "https://chez-lea.test/",
  email: "bonjour@chez-lea.test" as string | null,
  leadContactEmail: "Legacy.Owner@Chez-Lea.TEST" as string | null,
  status: "PROSPECT" as
    "PROSPECT" | "PREVIEW_READY" | "CLAIMED" | "LIVE" | "PAUSED",
  organizationId: null,
  attributes: {
    leadEligibility: {
      state: "ELIGIBLE",
      evidence: {
        channel_basis: "VERIFIED_WRITTEN_CONSENT",
        recipient: "Legacy.Owner@Chez-Lea.TEST",
        controller: "Corner Shop Labs Ltd",
        channel: "EMAIL",
        purpose: "CLAIM_INVITATION_AND_FOLLOW_UP",
        evidence_timestamp: "2026-08-20T09:00:00+02:00",
        evidence_source: "consent:owner-record-1234",
      },
      updatedAt: "2026-08-19T08:00:00.000Z",
      updatedBy: "operator:operator_1",
    },
  },
  updatedAt: new Date(clock),
};

function tick(): Date {
  clock += 1_000;
  return new Date(clock);
}

function siteRecord() {
  const reviews = auditEvents
    .filter(
      (event) =>
        event.siteId === site.id && event.type === "site.review.completed",
    )
    .sort(
      (left, right) => right.createdAt.getTime() - left.createdAt.getTime(),
    );
  return {
    ...site,
    auditEvents: reviews,
    outreachMessages: message?.template === "preview_ready" ? [message] : [],
  };
}

function matchesStatus(
  current: string,
  expected: string | { in: string[] } | undefined,
): boolean {
  if (!expected) return true;
  return typeof expected === "string"
    ? current === expected
    : expected.in.includes(current);
}

const fakeModels = {
  $queryRaw: async (
    strings: TemplateStringsArray,
    ...values: unknown[]
  ): Promise<unknown[]> => {
    const sql = strings.join("?");
    // Locked lead read used by createOrReopenOperatorLead.
    if (sql.includes('FROM "Site"') && sql.includes('"sourceKey"')) {
      if (typeof values[0] === "string" && values[0] !== site.sourceKey) {
        return [];
      }
      return [
        {
          id: site.id,
          slug: site.slug,
          status: site.status,
          vertical: site.vertical,
          attributes: site.attributes,
        },
      ];
    }
    // Locked read used by recordOperatorLeadAction.
    if (sql.includes('FROM "Site"') && sql.includes('"slug"')) {
      if (typeof values[0] === "string" && values[0] !== site.slug) {
        return [];
      }
      return [{ id: site.id, attributes: site.attributes }];
    }
    return [];
  },
  $executeRaw: async () => 0,
  site: {
    findUnique: async (input: {
      where: { id?: string; slug?: string; sourceKey?: string };
    }) => {
      const { where } = input;
      if (where.id && where.id !== site.id) return null;
      if (where.slug && where.slug !== site.slug) return null;
      if (where.sourceKey && where.sourceKey !== site.sourceKey) return null;
      return siteRecord();
    },
    updateMany: async (input: {
      where: { id: string; vertical?: string; status?: { in: string[] } };
      data: {
        status?: typeof site.status;
        leadContactEmail?: string;
      };
    }) => {
      if (
        input.where.id !== site.id ||
        (input.where.vertical && input.where.vertical !== site.vertical) ||
        (input.where.status && !input.where.status.in.includes(site.status))
      ) {
        return { count: 0 };
      }
      if (input.data.status) site.status = input.data.status;
      if (input.data.leadContactEmail) {
        site.leadContactEmail = input.data.leadContactEmail;
      }
      site.updatedAt = tick();
      return { count: 1 };
    },
    update: async (input: {
      where: { id: string };
      data: { attributes?: unknown };
    }) => {
      if (input.where.id !== site.id) throw new Error("site missing");
      if (input.data.attributes) {
        site.attributes = input.data.attributes as typeof site.attributes;
      }
      site.updatedAt = tick();
      return siteRecord();
    },
  },
  auditEvent: {
    create: async (input: {
      data: {
        type: string;
        actor?: string | null;
        metadata?: Record<string, unknown>;
        siteId?: string | null;
        createdAt?: Date;
      };
    }) => {
      const event: AuditEvent = {
        id: `audit_${auditEvents.length + 1}`,
        type: input.data.type,
        actor: input.data.actor ?? null,
        metadata: input.data.metadata ?? {},
        siteId: input.data.siteId ?? null,
        createdAt: input.data.createdAt ?? tick(),
      };
      auditEvents.push(event);
      return event;
    },
  },
  operatorSetting: {
    findUnique: async () => (paused ? { value: true } : null),
    findMany: async () =>
      paused ? [{ key: "outreach.paused", value: true }] : [],
    upsert: async (input: {
      update: { value: boolean };
      create: { value: boolean };
    }) => {
      paused = (paused ? input.update : input.create).value;
      return { value: paused };
    },
  },
  operatorAuditEvent: {
    create: async (input: { data: Record<string, unknown> }) => {
      operatorAuditEvents.push(input.data);
      return input.data;
    },
  },
  outreachDispatch: {
    upsert: async (input: {
      where: { idempotencyKey: string };
      create: Omit<
        Dispatch,
        | "status"
        | "workflowRunId"
        | "error"
        | "attempt"
        | "createdAt"
        | "updatedAt"
      >;
    }) => {
      if (dispatch?.idempotencyKey === input.where.idempotencyKey) {
        return dispatch;
      }
      const createdAt = tick();
      dispatch = {
        ...input.create,
        status: "QUEUED",
        workflowRunId: null,
        error: null,
        attempt: 1,
        createdAt,
        updatedAt: createdAt,
      };
      return dispatch;
    },
    updateMany: async (input: {
      where: {
        id: string;
        status?: string | { in: string[] };
        attempt?: number;
        workflowRunId?: string | null;
        updatedAt?: { lte: Date };
      };
      data: Omit<Partial<Dispatch>, "attempt"> & {
        attempt?: number | { increment: number };
      };
    }) => {
      if (
        !dispatch ||
        dispatch.id !== input.where.id ||
        !matchesStatus(dispatch.status, input.where.status) ||
        (input.where.attempt !== undefined &&
          dispatch.attempt !== input.where.attempt) ||
        (input.where.workflowRunId !== undefined &&
          dispatch.workflowRunId !== input.where.workflowRunId) ||
        (input.where.updatedAt &&
          dispatch.updatedAt > input.where.updatedAt.lte)
      ) {
        return { count: 0 };
      }
      const { attempt: nextAttempt, ...nextData } = input.data;
      Object.assign(dispatch, nextData);
      if (typeof nextAttempt === "object") {
        dispatch.attempt += nextAttempt.increment;
      } else if (typeof nextAttempt === "number") {
        dispatch.attempt = nextAttempt;
      }
      dispatch.updatedAt = tick();
      return { count: 1 };
    },
    findUnique: async (input: { where: { id?: string } }) =>
      dispatch && (!input.where.id || dispatch.id === input.where.id)
        ? dispatch
        : null,
    findUniqueOrThrow: async (input: { where: { id: string } }) => {
      if (!dispatch || dispatch.id !== input.where.id) {
        throw new Error("dispatch missing");
      }
      return dispatch;
    },
  },
  outreachMessage: {
    upsert: async (input: {
      where: { idempotencyKey: string };
      create: Omit<
        OutreachMessage,
        | "provider"
        | "providerMessageId"
        | "providerEventAt"
        | "providerAttemptedAt"
        | "error"
        | "sentAt"
        | "deliveredAt"
        | "createdAt"
        | "updatedAt"
      >;
    }) => {
      if (message?.idempotencyKey === input.where.idempotencyKey)
        return message;
      const createdAt = tick();
      message = {
        ...input.create,
        provider: "resend",
        providerMessageId: null,
        rfcMessageId: input.create.rfcMessageId ?? null,
        providerEventAt: null,
        providerAttemptedAt: null,
        deliveryLeaseId: input.create.deliveryLeaseId ?? null,
        deliveryLeaseExpiresAt: input.create.deliveryLeaseExpiresAt ?? null,
        inReplyTo: input.create.inReplyTo ?? null,
        threadKey: input.create.threadKey ?? null,
        createdByActor: input.create.createdByActor ?? null,
        error: null,
        sentAt: null,
        deliveredAt: null,
        receivedAt: input.create.receivedAt ?? null,
        createdAt,
        updatedAt: createdAt,
      };
      return message;
    },
    findUnique: async (input: {
      where: {
        id?: string;
        idempotencyKey?: string;
        providerMessageId?: string;
      };
    }) => {
      if (!message) return null;
      if (input.where.id && input.where.id !== message.id) return null;
      if (
        input.where.idempotencyKey &&
        input.where.idempotencyKey !== message.idempotencyKey
      ) {
        return null;
      }
      if (
        input.where.providerMessageId &&
        input.where.providerMessageId !== message.providerMessageId
      ) {
        return null;
      }
      return message;
    },
    findUniqueOrThrow: async (input: { where: { id: string } }) => {
      if (!message || message.id !== input.where.id) {
        throw new Error("message missing");
      }
      return message;
    },
    findMany: async () => (message ? [message] : []),
    findFirst: async (input: {
      where: {
        id?: string;
        siteId?: string;
        direction?: string;
        OR?: Array<
          | { status: { in: string[] } }
          | { status: string; error: { contains: string; mode: string } }
        >;
      };
    }) => {
      if (!message) return null;
      const currentMessage = message;
      if (input.where.id && input.where.id !== message.id) return null;
      if (input.where.siteId && input.where.siteId !== message.siteId) {
        return null;
      }
      if (
        input.where.direction &&
        input.where.direction !== message.direction
      ) {
        return null;
      }
      if (
        input.where.OR &&
        !input.where.OR.some((condition) =>
          !("error" in condition)
            ? condition.status.in.includes(currentMessage.status)
            : currentMessage.status === condition.status &&
              currentMessage.error
                ?.toLowerCase()
                .includes(condition.error.contains.toLowerCase()) === true,
        )
      ) {
        return null;
      }
      return message;
    },
    updateMany: async (input: {
      where: {
        id: string;
        status?: string | { in: string[] };
        providerMessageId?: string | null;
        providerAttemptedAt?: Date | null;
        deliveryLeaseId?: string | null;
        OR?: Array<Record<string, unknown>>;
        AND?: Array<Record<string, unknown>>;
      };
      data: Partial<OutreachMessage>;
    }) => {
      if (
        !message ||
        message.id !== input.where.id ||
        !matchesStatus(message.status, input.where.status) ||
        (input.where.providerMessageId !== undefined &&
          message.providerMessageId !== input.where.providerMessageId) ||
        (input.where.providerAttemptedAt !== undefined &&
          message.providerAttemptedAt !== input.where.providerAttemptedAt) ||
        (input.where.deliveryLeaseId !== undefined &&
          message.deliveryLeaseId !== input.where.deliveryLeaseId)
      ) {
        return { count: 0 };
      }
      if (
        input.where.OR &&
        !input.where.OR.some((condition) =>
          "providerMessageId" in condition
            ? condition.providerMessageId === message?.providerMessageId
            : true,
        )
      ) {
        return { count: 0 };
      }
      Object.assign(
        message,
        Object.fromEntries(
          Object.entries(input.data).filter(([, value]) => value !== undefined),
        ),
        { updatedAt: tick() },
      );
      return { count: 1 };
    },
  },
  outreachProviderEvent: {
    upsert: async (input: {
      where: { id: string };
      create: Record<string, unknown>;
    }) => {
      const existing = providerEvents.get(input.where.id);
      if (existing) return existing;
      providerEvents.set(input.where.id, input.create);
      return input.create;
    },
  },
  claimInvitation: {
    findUnique: async (input: {
      where: { id?: string; outreachKey?: string };
    }) => {
      if (!invitation) return null;
      if (input.where.id && input.where.id !== invitation.id) return null;
      if (
        input.where.outreachKey &&
        input.where.outreachKey !== invitation.outreachKey
      ) {
        return null;
      }
      return invitation;
    },
    findFirst: async () => null,
    updateMany: async () => {
      if (invitation && !invitation.acceptedAt && !invitation.revokedAt) {
        invitation.revokedAt = tick();
        return { count: 1 };
      }
      return { count: 0 };
    },
    update: async (input: {
      where: { id: string };
      data: Partial<ClaimInvitation>;
    }) => {
      if (!invitation || invitation.id !== input.where.id) {
        throw new Error("invitation missing");
      }
      Object.assign(invitation, input.data);
      return invitation;
    },
    create: async (input: {
      data: Omit<
        ClaimInvitation,
        "id" | "verifiedAt" | "acceptedAt" | "revokedAt" | "checkoutSessionId"
      >;
    }) => {
      invitation = {
        id: "invitation_1",
        ...input.data,
        verifiedAt: null,
        acceptedAt: null,
        revokedAt: null,
        checkoutSessionId: null,
      };
      return invitation;
    },
  },
};

const fakeDb = {
  ...fakeModels,
  $transaction: async <T>(
    callback: (transaction: typeof fakeModels) => Promise<T> | T,
  ): Promise<T> => callback(fakeModels),
};

const providerSend = mock(
  async (
    _payload: {
      from: string;
      to: string;
      replyTo?: string;
      subject: string;
      html?: string;
      text: string;
      headers?: Record<string, string>;
      tags: Array<{ name: string; value: string }>;
    },
    _idempotencyKey: string,
  ) => {
    void _payload;
    void _idempotencyKey;
    return {
      data: { id: "resend_message_1" },
      error: null,
    };
  },
);
const workflowStart = mock(async () => ({ runId: "workflow_run_1" }));

mock.module("@/lib/db", () => ({ getDb: () => fakeDb }));
mock.module("@/lib/authorization", () => ({
  getSuperadminAccess: async () => ({
    id: "operator_1",
    email: "operator@example.test",
  }),
}));
mock.module("@/lib/rate-limit", () => rateLimitTestModule);
mock.module("@/lib/outreach-readiness", () => outreachReadinessTestModule);
mock.module("workflow/api", () => ({ start: workflowStart }));
mock.module("@/workflows/lead-outreach", () => ({
  leadOutreachWorkflow: async () => {},
}));
mock.module("@/lib/operator-alerts", () => ({
  captureOperatorAlert: async () => "delivered" as const,
}));
mock.module("@/lib/resend", () => ({
  getResend: () => ({ emails: { send: providerSend } }),
  sendBoundedResendEmail: providerSend,
  emailSender: (vertical?: string | null) =>
    vertical === "RESTAURANT"
      ? "Vincent from Restofrontapp <vincent@send.restofront.com>"
      : "Cornershopdev <onboarding@resend.dev>",
  emailReplyTo: (vertical?: string | null) =>
    vertical === "RESTAURANT" ? "vincent@restofront.com" : undefined,
}));

const { POST: createOrReopenLead } =
  await import("@/app/api/admin/leads/batch/route");
const { POST: completeReview } =
  await import("@/app/api/admin/sites/[slug]/review/route");
const { GET: getOutreach, POST: queueOutreach } =
  await import("@/app/api/admin/leads/[slug]/outreach/route");
const { POST: setOutreachPause } =
  await import("@/app/api/admin/outreach/pause/route");
const { markInitialOutreachDispatchFinished, reserveInitialOutreachDispatch } =
  await import("@/lib/outreach-dispatch");
const { issueClaimInvitation } = await import("@/lib/claim-invitations");
const { recordResendOutreachEvent } =
  await import("@/lib/outreach-event-recorder");
const { listOutreachMessages, sendLeadEmail } = await import("@/lib/outreach");
const { ingestOperatorProspectLead } =
  await import("@/lib/operator-lead-ingest");

describe("mocked Restofront operator delivery flow", () => {
  beforeEach(() => {
    clock = new Date("2026-08-19T08:00:00.000Z").getTime();
    site.email = "bonjour@chez-lea.test";
    site.leadContactEmail = "Legacy.Owner@Chez-Lea.TEST";
    site.attributes.leadEligibility.evidence.recipient =
      "Legacy.Owner@Chez-Lea.TEST";
    site.status = "PROSPECT";
    site.updatedAt = new Date(clock);
    dispatch = null;
    message = null;
    invitation = null;
    paused = false;
    auditEvents.length = 0;
    operatorAuditEvents.length = 0;
    providerEvents.clear();
    providerSend.mockClear();
    workflowStart.mockClear();
    process.env.NEXT_PUBLIC_APP_URL = "https://cornershop.dev";
    process.env.DATABASE_URL = "postgresql://mocked.invalid/cornershopdev";
    process.env.RESEND_WEBHOOK_SECRET = `whsec_${Buffer.from(
      "test-only-webhook-signing-key",
    ).toString("base64")}`;
    process.env.CLAIM_TOKEN_SECRET =
      "mocked-claim-token-secret-with-more-than-32-characters";
  });

  it("rejects manual and discovery cross-vertical source reuse without mutation", async () => {
    const originalContact = site.leadContactEmail;
    const manualResponse = await createOrReopenLead(
      sameOriginRequest("/api/admin/leads/batch", {
        leads: [
          {
            source: "https://chez-lea.test",
            contactEmail: "beauty-owner@example.test",
            vertical: "BEAUTY",
          },
        ],
        sendEmail: false,
      }),
    );
    const manual = (await manualResponse.json()) as {
      results: Array<{ error?: string }>;
    };

    expect(manual.results[0]?.error).toContain("another vertical");
    expect(site.status).toBe("PROSPECT");
    expect(site.leadContactEmail).toBe(originalContact);
    expect(auditEvents).toHaveLength(0);

    await expect(
      ingestOperatorProspectLead({
        source: "https://chez-lea.test/",
        websiteUrl: "https://chez-lea.test/",
        vertical: "BEAUTY",
        name: "Chez Léa Beauty",
        city: "Valletta",
        score: 20,
        reasons: ["Cross-vertical regression"],
        queries: [
          { provider: "google_places", query: "beauty salons in Valletta" },
        ],
        generatePreview: true,
      }),
    ).rejects.toThrow("another vertical");
    expect(site.status).toBe("PROSPECT");
    expect(site.name).toBe("Chez Léa");
    expect(site.leadContactEmail).toBe(originalContact);
    expect(auditEvents).toHaveLength(0);
  });

  it("reopens and reviews a persisted preview, explicitly sends, refreshes status, then pauses", async () => {
    const intakeResponse = await createOrReopenLead(
      sameOriginRequest("/api/admin/leads/batch", {
        leads: [
          {
            source: "https://chez-lea.test",
            contactEmail: "Owner@Chez-Lea.TEST",
            vertical: "RESTAURANT",
          },
        ],
        sendEmail: false,
      }),
    );
    expect(intakeResponse.status).toBe(200);
    expect(site.status).toBe("PREVIEW_READY");
    expect(site.email).toBe("bonjour@chez-lea.test");
    expect(site.leadContactEmail).toBe("owner@chez-lea.test");
    expect(providerSend).not.toHaveBeenCalled();

    // A separate read sees the same private preview identity and contact.
    expect(
      await fakeModels.site.findUnique({ where: { slug: site.slug } }),
    ).toMatchObject({
      slug: "chez-lea",
      status: "PREVIEW_READY",
      email: "bonjour@chez-lea.test",
      leadContactEmail: "owner@chez-lea.test",
    });

    const eligibilityResponse = await completeReview(
      sameOriginRequest(`/api/admin/sites/${site.slug}/review`, {
        action: "set_eligibility",
        eligibility: "ELIGIBLE",
        eligibilityEvidence: {
          channel_basis: "VERIFIED_WRITTEN_CONSENT",
          recipient: "owner@chez-lea.test",
          controller: "Corner Shop Labs Ltd",
          channel: "EMAIL",
          purpose: "CLAIM_INVITATION_AND_FOLLOW_UP",
          evidence_timestamp: "2026-08-20T09:00:00+02:00",
          evidence_source: "consent:owner-record-1234",
        },
        note: null,
      }),
      siteContext(completeReview),
    );
    expect(eligibilityResponse.status).toBe(200);

    const reviewResponse = await completeReview(
      sameOriginRequest(`/api/admin/sites/${site.slug}/review`, {
        action: "complete_review",
        note: null,
      }),
      siteContext(completeReview),
    );
    const reviewPayload = (await reviewResponse.json()) as {
      createdAt: string;
    };
    expect(reviewResponse.status).toBe(200);

    const queueResponse = await queueOutreach(
      sameOriginRequest(`/api/admin/leads/${site.slug}/outreach`, {
        action: "send_initial",
        recipient: "owner@chez-lea.test",
        reviewedAt: reviewPayload.createdAt,
      }),
      siteContext(queueOutreach),
    );
    expect(queueResponse.status).toBe(202);
    expect(dispatch).toMatchObject({
      status: "QUEUED",
      workflowRunId: "workflow_run_1",
      attempt: 1,
    });
    expect(workflowStart).toHaveBeenCalledTimes(1);

    // A refresh/repeated action reads the persisted reservation and does not
    // launch another workflow while the first run is queued.
    const refreshResponse = await queueOutreach(
      sameOriginRequest(`/api/admin/leads/${site.slug}/outreach`, {
        action: "send_initial",
        recipient: "owner@chez-lea.test",
        reviewedAt: reviewPayload.createdAt,
      }),
      siteContext(queueOutreach),
    );
    expect(refreshResponse.status).toBe(200);
    expect(await refreshResponse.json()).toMatchObject({
      started: false,
      status: "QUEUED",
    });
    expect(workflowStart).toHaveBeenCalledTimes(1);

    const issued = await issueClaimInvitation({
      siteSlug: site.slug,
      email: site.leadContactEmail!,
      proofMethod: "OPERATOR_APPROVAL",
      actor: "operator:operator_1",
      outreachKey: `lead-outreach:${site.id}:preview_ready`,
      outreachDispatch: {
        id: dispatch!.id,
        attempt: dispatch!.attempt,
        recipient: dispatch!.recipient,
        reviewedAt: reviewPayload.createdAt,
        stage: "preview_ready",
      },
    });
    const replayedInvitation = await issueClaimInvitation({
      siteSlug: site.slug,
      email: site.leadContactEmail!,
      proofMethod: "OPERATOR_APPROVAL",
      actor: "operator:operator_1",
      outreachKey: `lead-outreach:${site.id}:preview_ready`,
      outreachDispatch: {
        id: dispatch!.id,
        attempt: dispatch!.attempt,
        recipient: dispatch!.recipient,
        reviewedAt: reviewPayload.createdAt,
        stage: "preview_ready",
      },
    });
    expect(replayedInvitation.id).toBe(issued.id);
    expect(invitation).toMatchObject({
      approvalEvidenceRef: `outreach-dispatch:${dispatch!.id}`,
      approvedBy: "operator:operator_1",
      approvedAt: expect.any(Date),
    });
    const sent = await sendLeadEmail({
      siteId: site.id,
      template: "preview_ready",
      claimUrl: `https://cornershop.dev/claim/${site.slug}#claim_token=${issued.token}`,
      to: site.leadContactEmail!,
      actor: "operator:operator_1",
      expectedReviewedAt: reviewPayload.createdAt,
      claimInvitationId: issued.id,
      dispatchAuthorization: {
        dispatchId: dispatch!.id,
        attempt: dispatch!.attempt,
      },
    });
    await markInitialOutreachDispatchFinished({
      dispatchId: dispatch!.id,
      siteId: site.id,
      actor: "operator:operator_1",
      status: "SENT",
      attempt: dispatch!.attempt,
    });

    expect(sent.status).toBe("SENT");
    expect(dispatch?.status).toBe("SENT");
    expect(providerSend).toHaveBeenCalledTimes(1);
    expect(providerSend.mock.calls[0]![0]).toMatchObject({
      from: "Vincent from Restofrontapp <vincent@send.restofront.com>",
      replyTo: "vincent+chez-lea@restofront.com",
      to: "owner@chez-lea.test",
    });
    expect(providerSend.mock.calls[0]![0].html).toContain(
      "https://cornershop.dev/preview/chez-lea",
    );
    expect(providerSend.mock.calls[0]![0].html).toContain("claim_token=");
    expect(message?.textBody).not.toContain("claim_token=");

    message!.error = "Provider acceptance is unknown; awaiting signed status.";
    const delivery = await recordResendOutreachEvent({
      eventId: "webhook_delivery_1",
      eventType: "email.delivered",
      occurredAt: new Date(),
      providerMessageId: "resend_message_1",
      taggedOutreachMessageId: message!.id,
    });
    expect(delivery).toEqual({ handled: true, updated: 1 });

    const mailboxResponse = await getOutreach(
      new Request(
        `https://cornershop.dev/api/admin/leads/${site.slug}/outreach`,
      ),
      siteContext(getOutreach),
    );
    expect(mailboxResponse.status).toBe(200);
    expect(await mailboxResponse.json()).toMatchObject({
      messages: [
        {
          status: "DELIVERED",
          toAddress: "owner@chez-lea.test",
        },
      ],
    });
    expect((await listOutreachMessages(site.id))[0]).toMatchObject({
      status: "DELIVERED",
      deliveredAt: expect.any(Date),
      error: null,
    });

    const pauseResponse = await setOutreachPause(
      sameOriginRequest("/api/admin/outreach/pause", { paused: true }),
    );
    expect(pauseResponse.status).toBe(200);
    expect(paused).toBe(true);
    await expect(
      issueClaimInvitation({
        siteSlug: site.slug,
        email: site.leadContactEmail!,
        proofMethod: "OPERATOR_APPROVAL",
        actor: "operator:operator_1",
        outreachKey: `lead-outreach:${site.id}:follow_up_1`,
        outreachDispatch: {
          id: dispatch!.id,
          attempt: dispatch!.attempt,
          recipient: dispatch!.recipient,
          reviewedAt: reviewPayload.createdAt,
          stage: "follow_up_1",
        },
      }),
    ).rejects.toThrow("changed before invitation issuance");
    expect(providerSend).toHaveBeenCalledTimes(1);
    expect(operatorAuditEvents.at(-1)).toMatchObject({
      type: "outreach.paused",
      metadata: { paused: true },
    });

    paused = false;
    const replyResponse = await queueOutreach(
      sameOriginRequest(`/api/admin/leads/${site.slug}/outreach`, {
        action: "reply",
        body: "Happy to walk through the preview.",
        inReplyToMessageId: message!.id,
      }),
      siteContext(queueOutreach),
    );
    expect(replyResponse.status).toBe(200);
    expect(workflowStart).toHaveBeenCalledTimes(1);
    expect(providerSend).toHaveBeenCalledTimes(2);
    expect(providerSend.mock.calls[1]![0].headers).toMatchObject({
      "In-Reply-To": expect.stringContaining("outreach_"),
    });
  });

  it("replays an ambiguous stale reservation but increments a definite failure", async () => {
    site.leadContactEmail = "owner@chez-lea.test";
    site.attributes.leadEligibility.evidence.recipient = "owner@chez-lea.test";
    dispatch = {
      id: "dispatch_stale",
      idempotencyKey: `lead-outreach:${site.id}:preview_ready`,
      siteId: site.id,
      template: "preview_ready",
      recipient: "owner@chez-lea.test",
      reviewedAt: new Date("2026-08-19T08:01:00.000Z"),
      requestedBy: "operator:old",
      status: "QUEUED",
      workflowRunId: null,
      error: null,
      attempt: 3,
      createdAt: new Date("2026-08-19T07:00:00.000Z"),
      updatedAt: new Date("2026-08-19T07:00:00.000Z"),
    };
    const now = new Date("2026-08-19T08:30:00.000Z");
    const replay = await reserveInitialOutreachDispatch({
      siteId: site.id,
      recipient: "owner@chez-lea.test",
      reviewedAt: new Date("2026-08-19T08:01:00.000Z"),
      actor: "operator:replay",
      now,
    });
    expect(replay).toMatchObject({ acquired: true, attempt: 3 });

    await markInitialOutreachDispatchFinished({
      dispatchId: replay.id,
      siteId: site.id,
      actor: "operator:replay",
      status: "FAILED",
      attempt: 3,
      error: "Provider rejected before acceptance.",
    });
    const retry = await reserveInitialOutreachDispatch({
      siteId: site.id,
      recipient: "owner@chez-lea.test",
      reviewedAt: new Date("2026-08-19T08:01:00.000Z"),
      actor: "operator:retry",
      now,
    });
    expect(retry).toMatchObject({ acquired: true, attempt: 4 });

    await markInitialOutreachDispatchFinished({
      dispatchId: retry.id,
      siteId: site.id,
      actor: "operator:stale-worker",
      status: "SENT",
      attempt: 3,
    });
    expect(dispatch).toMatchObject({ status: "QUEUED", attempt: 4 });
  });
});

function sameOriginRequest(path: string, body: unknown): Request {
  return new Request(`https://cornershop.dev${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: "https://cornershop.dev",
    },
    body: JSON.stringify(body),
  });
}

function siteContext<T extends (...args: never[]) => unknown>(handler: T) {
  void handler;
  return {
    params: Promise.resolve({ slug: site.slug }),
  } as Parameters<T>[1];
}
