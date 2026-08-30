import { beforeEach, describe, expect, it, mock } from "bun:test";

mock.module("server-only", () => ({}));
process.env.OUTREACH_LEGAL_CONTROLLER = "Corner Shop Labs Ltd";

type StoredMessage = {
  id: string;
  idempotencyKey: string;
  siteId: string;
  direction: "OUTBOUND" | "INBOUND";
  provider: string;
  providerMessageId: string | null;
  rfcMessageId?: string | null;
  fromAddress: string;
  replyToAddress: string | null;
  toAddress: string;
  subject: string;
  textBody: string;
  htmlBody: string | null;
  template: string | null;
  inReplyTo?: string | null;
  threadKey?: string | null;
  createdByActor?: string | null;
  status:
    | "QUEUED"
    | "SENT"
    | "DELIVERED"
    | "BOUNCED"
    | "COMPLAINED"
    | "FAILED"
    | "RECEIVED";
  error: string | null;
  sentAt: Date | null;
  deliveredAt: Date | null;
  receivedAt?: Date | null;
  providerEventAt: Date | null;
  providerAttemptedAt: Date | null;
  deliveryLeaseId: string | null;
  deliveryLeaseExpiresAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

const messages = new Map<string, StoredMessage>();
let persistedContactEmail = "owner@chez-lea.test";
let outreachPaused = false;
let leadEligibilityState: "ELIGIBLE" | "INELIGIBLE" = "ELIGIBLE";
let leadEligibilityEvidence: Record<string, string> = {};
const reviewedAt = "2026-08-19T08:01:00.000Z";
let dispatchStatus: "QUEUED" | "SENT" = "QUEUED";
let dispatchAttempt = 1;
let loseRetryResetCas = false;
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
  ): Promise<{
    data: { id: string } | null;
    error: { message: string; statusCode: number | null } | null;
  }> => {
    void _payload;
    void _idempotencyKey;
    return {
      data: { id: "resend_message_1" },
      error: null,
    };
  },
);

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

const fakeDb = {
  $queryRaw: async () => [{ acquired: true }],
  $executeRaw: async () => 0,
  site: {
    findUnique: async () => ({
      slug: "chez-lea",
      name: "Chez Léa",
      vertical: "RESTAURANT",
      attributes: {
        leadEligibility: {
          state: leadEligibilityState,
          evidence: leadEligibilityEvidence,
          updatedAt: "2026-08-19T08:00:00.000Z",
          updatedBy: "operator:one",
        },
      },
      email: "bonjour@chez-lea.test",
      leadContactEmail: persistedContactEmail,
      status: "PREVIEW_READY",
      updatedAt: new Date("2026-08-19T08:00:00.000Z"),
      auditEvents: [{ createdAt: new Date("2026-08-19T08:01:00.000Z") }],
    }),
  },
  operatorSetting: {
    findUnique: async () => (outreachPaused ? { value: true } : null),
    findMany: async () =>
      outreachPaused ? [{ key: "outreach.paused", value: true }] : [],
  },
  outreachMessage: {
    upsert: async (input: {
      where: { idempotencyKey: string };
      create: Omit<
        StoredMessage,
        | "provider"
        | "providerMessageId"
        | "error"
        | "sentAt"
        | "deliveredAt"
        | "providerAttemptedAt"
        | "createdAt"
        | "updatedAt"
      >;
    }) => {
      const existing = messages.get(input.where.idempotencyKey);
      if (existing) return existing;
      const now = new Date();
      const created: StoredMessage = {
        ...input.create,
        provider: "resend",
        providerMessageId: null,
        error: null,
        sentAt: null,
        deliveredAt: null,
        providerEventAt: null,
        providerAttemptedAt: null,
        deliveryLeaseId: input.create.deliveryLeaseId ?? null,
        deliveryLeaseExpiresAt: input.create.deliveryLeaseExpiresAt ?? null,
        createdAt: now,
        updatedAt: now,
      };
      messages.set(created.idempotencyKey, created);
      return created;
    },
    updateMany: async (input: {
      where: {
        id: string;
        status?: string;
        providerAttemptedAt?: Date | null;
        deliveryLeaseId?: string | null;
      };
      data: Partial<StoredMessage>;
    }) => {
      const existing = [...messages.values()].find(
        (message) => message.id === input.where.id,
      );
      if (!existing) throw new Error("message missing");
      if (
        loseRetryResetCas &&
        input.where.status === "FAILED" &&
        input.data.status === "QUEUED"
      ) {
        return { count: 0 };
      }
      if (input.where.status && existing.status !== input.where.status) {
        return { count: 0 };
      }
      if (
        input.where.providerAttemptedAt !== undefined &&
        existing.providerAttemptedAt !== input.where.providerAttemptedAt
      ) {
        return { count: 0 };
      }
      if (
        input.where.deliveryLeaseId !== undefined &&
        existing.deliveryLeaseId !== input.where.deliveryLeaseId
      ) {
        return { count: 0 };
      }
      Object.assign(existing, input.data, { updatedAt: new Date() });
      return { count: 1 };
    },
    findUnique: async (input: {
      where: { idempotencyKey?: string; id?: string };
    }) => {
      const existing = [...messages.values()].find((message) =>
        input.where.id
          ? message.id === input.where.id
          : message.idempotencyKey === input.where.idempotencyKey,
      );
      return existing ?? null;
    },
    findUniqueOrThrow: async (input: { where: { id: string } }) => {
      const existing = [...messages.values()].find(
        (message) => message.id === input.where.id,
      );
      if (!existing) throw new Error("message missing");
      return existing;
    },
    findMany: async () => [...messages.values()],
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
      return (
        [...messages.values()].find((message) => {
          if (input.where.id && message.id !== input.where.id) return false;
          if (input.where.siteId && message.siteId !== input.where.siteId) {
            return false;
          }
          if (
            input.where.direction &&
            message.direction !== input.where.direction
          ) {
            return false;
          }
          if (
            input.where.OR &&
            !input.where.OR.some((condition) => {
              if (!("error" in condition)) {
                return condition.status.in.includes(message.status);
              }
              return (
                message.status === condition.status &&
                message.error
                  ?.toLowerCase()
                  .includes(condition.error.contains.toLowerCase()) === true
              );
            })
          ) {
            return false;
          }
          return true;
        }) ?? null
      );
    },
  },
  outreachDispatch: {
    findUnique: async () => ({
      siteId: "site_1",
      template: "preview_ready",
      recipient: persistedContactEmail,
      reviewedAt: new Date(reviewedAt),
      status: dispatchStatus,
      attempt: dispatchAttempt,
    }),
  },
  claimInvitation: {
    findUnique: async (input: { where: { id: string } }) => ({
      siteId: "site_1",
      email: persistedContactEmail,
      outreachKey: input.where.id.includes("follow_up")
        ? "lead-outreach:site_1:follow_up_1"
        : "lead-outreach:site_1:preview_ready",
      expiresAt: new Date("2099-08-21T08:00:00.000Z"),
      acceptedAt: null,
      revokedAt: null,
    }),
  },
  $transaction: async (callback: (transaction: object) => unknown) =>
    callback(fakeDb),
};

mock.module("@/lib/db", () => ({ getDb: () => fakeDb }));

const { sendLeadEmail } = await import("@/lib/outreach");
const { leadBatchRequestSchema } = await import("@/lib/operator-lead-batch");
const { canApplyResendOutreachEvent } =
  await import("@/lib/outreach-event-policy");
const { isReviewedLead } = await import("@/workflows/lead-outreach");

describe("outreach delivery idempotency", () => {
  beforeEach(() => {
    messages.clear();
    persistedContactEmail = "owner@chez-lea.test";
    outreachPaused = false;
    leadEligibilityState = "ELIGIBLE";
    leadEligibilityEvidence = {
      channel_basis: "VERIFIED_WRITTEN_CONSENT",
      recipient: "owner@chez-lea.test",
      controller: "Corner Shop Labs Ltd",
      channel: "EMAIL",
      purpose: "CLAIM_INVITATION_AND_FOLLOW_UP",
      evidence_timestamp: "2026-08-20T09:00:00+02:00",
      evidence_source: "consent:owner-record-1234",
    };
    dispatchStatus = "QUEUED";
    dispatchAttempt = 1;
    loseRetryResetCas = false;
    providerSend.mockClear();
    process.env.NEXT_PUBLIC_APP_URL = "https://cornershop.dev";
  });

  it("keeps intake non-sending and the persisted mailbox free of bearer tokens", async () => {
    const intake = leadBatchRequestSchema.parse({
      leads: [
        {
          source: "https://chez-lea.test",
          contactEmail: "owner@chez-lea.test",
          vertical: "RESTAURANT",
        },
      ],
      sendEmail: false,
    });
    persistedContactEmail = intake.leads[0]!.contactEmail!;
    const site = {
      status: "PREVIEW_READY",
      leadContactEmail: persistedContactEmail,
      attributes: {
        leadEligibility: {
          state: "ELIGIBLE",
          evidence: {
            channel_basis: "VERIFIED_WRITTEN_CONSENT",
            recipient: persistedContactEmail,
            controller: "Corner Shop Labs Ltd",
            channel: "EMAIL",
            purpose: "CLAIM_INVITATION_AND_FOLLOW_UP",
            evidence_timestamp: "2026-08-20T09:00:00+02:00",
            evidence_source: "consent:owner-record-1234",
          },
          updatedAt: "2026-08-19T08:00:00.000Z",
          updatedBy: "operator:one",
        },
      },
      vertical: "RESTAURANT",
      updatedAt: new Date("2026-08-19T08:00:00.000Z"),
      auditEvents: [{ createdAt: new Date("2026-08-19T08:01:00.000Z") }],
    };

    expect(intake.sendEmail).toBe(false);
    expect(isReviewedLead(site, false, persistedContactEmail, reviewedAt)).toBe(
      true,
    );

    const sent = await sendLeadEmail({
      siteId: "site_1",
      template: "preview_ready",
      claimUrl:
        "https://cornershop.dev/claim/chez-lea#claim_token=stable-stage-token",
      to: persistedContactEmail,
      actor: "operator:one",
      expectedReviewedAt: reviewedAt,
      claimInvitationId: "invitation_preview",
      dispatchAuthorization: { dispatchId: "dispatch_1", attempt: 1 },
    });
    const message = [...messages.values()][0]!;

    expect(sent.status).toBe("SENT");
    expect(message.textBody).toContain(
      "https://cornershop.dev/preview/chez-lea",
    );
    expect(message.textBody).not.toContain("stable-stage-token");
    expect(message.htmlBody).not.toContain("stable-stage-token");
    expect(providerSend.mock.calls[0]![0].text).toContain(
      "claim_token=stable-stage-token",
    );
    expect(
      canApplyResendOutreachEvent({
        currentStatus: message.status,
        currentEventAt: null,
        eventType: "email.delivered",
        occurredAt: new Date("2026-08-19T08:02:00.000Z"),
      }),
    ).toBe(true);

    outreachPaused = true;
    dispatchStatus = "SENT";
    await expect(
      sendLeadEmail({
        siteId: "site_1",
        template: "follow_up_1",
        claimUrl: "https://cornershop.dev/claim/chez-lea#claim_token=follow-up",
        to: persistedContactEmail,
        actor: "operator:one",
        expectedReviewedAt: reviewedAt,
        claimInvitationId: "invitation_follow_up",
        dispatchAuthorization: { dispatchId: "dispatch_1", attempt: 1 },
      }),
    ).rejects.toThrow("became ineligible");
    expect(providerSend).toHaveBeenCalledTimes(1);
  });

  it("sends an operator reply through the same mailbox with thread headers", async () => {
    await sendLeadEmail({
      siteId: "site_1",
      template: "preview_ready",
      claimUrl:
        "https://cornershop.dev/claim/chez-lea#claim_token=stable-stage-token",
      to: persistedContactEmail,
      actor: "operator:one",
      expectedReviewedAt: reviewedAt,
      claimInvitationId: "invitation_preview",
      dispatchAuthorization: { dispatchId: "dispatch_1", attempt: 1 },
    });
    providerSend.mockClear();

    const reply = await sendLeadEmail({
      siteId: "site_1",
      template: "operator_reply",
      body: "Happy to walk through the preview on a call.",
      actor: "operator:one",
    });
    const stored = [...messages.values()].find(
      (message) => message.template === "operator_reply",
    );

    expect(reply.status).toBe("SENT");
    expect(stored).toMatchObject({
      direction: "OUTBOUND",
      toAddress: "owner@chez-lea.test",
      inReplyTo: expect.stringContaining("outreach_"),
    });
    expect(providerSend).toHaveBeenCalledTimes(1);
    expect(providerSend.mock.calls[0]![0].headers).toMatchObject({
      "In-Reply-To": expect.stringContaining("outreach_"),
    });
    expect(providerSend.mock.calls[0]![0].text).toContain(
      "Happy to walk through the preview on a call.",
    );
  });

  it("blocks an operator reply when channel authorization is revoked", async () => {
    await sendLeadEmail({
      siteId: "site_1",
      template: "preview_ready",
      claimUrl: "https://cornershop.dev/claim/chez-lea#claim_token=initial",
      actor: "operator:one",
      expectedReviewedAt: reviewedAt,
      claimInvitationId: "invitation_preview",
      dispatchAuthorization: { dispatchId: "dispatch_1", attempt: 1 },
    });
    providerSend.mockClear();
    leadEligibilityEvidence = { contact_basis: "generic corporate" };

    await expect(
      sendLeadEmail({
        siteId: "site_1",
        template: "operator_reply",
        body: "This must remain unsent.",
        actor: "operator:one",
      }),
    ).rejects.toThrow("Electronic outreach requires");

    expect(providerSend).not.toHaveBeenCalled();
    expect(
      [...messages.values()].find(
        (candidate) => candidate.template === "operator_reply",
      ),
    ).toMatchObject({ status: "FAILED", providerAttemptedAt: null });
  });

  it.each([
    { status: "BOUNCED" as const, error: "Recipient address bounced." },
    {
      status: "COMPLAINED" as const,
      error: "Recipient reported this email as spam.",
    },
    {
      status: "FAILED" as const,
      error: "Provider suppressed delivery to this recipient.",
    },
  ])(
    "blocks an operator reply after $status suppression",
    async ({ status, error }) => {
      await sendLeadEmail({
        siteId: "site_1",
        template: "preview_ready",
        claimUrl: "https://cornershop.dev/claim/chez-lea#claim_token=initial",
        actor: "operator:one",
        expectedReviewedAt: reviewedAt,
        claimInvitationId: "invitation_preview",
        dispatchAuthorization: { dispatchId: "dispatch_1", attempt: 1 },
      });
      const initial = [...messages.values()][0]!;
      initial.status = status;
      initial.error = error;
      providerSend.mockClear();

      await expect(
        sendLeadEmail({
          siteId: "site_1",
          template: "operator_reply",
          body: "This must remain suppressed.",
          actor: "operator:one",
        }),
      ).rejects.toThrow("recipient is suppressed");
      expect(providerSend).not.toHaveBeenCalled();
    },
  );

  it("converges duplicate initial sends on one persisted message and provider call", async () => {
    const first = await sendLeadEmail({
      siteId: "site_1",
      template: "preview_ready",
      claimUrl: "https://cornershop.dev/claim/chez-lea#claim_token=first",
      actor: "operator:one",
      expectedReviewedAt: reviewedAt,
      claimInvitationId: "invitation_preview",
      dispatchAuthorization: { dispatchId: "dispatch_1", attempt: 1 },
    });
    const duplicate = await sendLeadEmail({
      siteId: "site_1",
      template: "preview_ready",
      claimUrl: "https://cornershop.dev/claim/chez-lea#claim_token=duplicate",
      actor: "operator:two",
      expectedReviewedAt: reviewedAt,
      claimInvitationId: "invitation_preview",
      dispatchAuthorization: { dispatchId: "dispatch_1", attempt: 1 },
    });

    expect(first).toMatchObject({ status: "SENT", deduplicated: false });
    expect(duplicate).toEqual({
      id: first.id,
      status: "SENT",
      deduplicated: true,
    });
    expect(messages).toHaveLength(1);
    expect(providerSend).toHaveBeenCalledTimes(1);

    const [payload, idempotencyKey] = providerSend.mock.calls[0]!;
    expect(payload).toMatchObject({
      from: "Vincent from Restofrontapp <vincent@send.restofront.com>",
      replyTo: "vincent+chez-lea@restofront.com",
      to: "owner@chez-lea.test",
      tags: [
        { name: "category", value: "lead_outreach" },
        { name: "outreach_message_id", value: first.id },
      ],
    });
    expect(payload.html).toContain("https://cornershop.dev/preview/chez-lea");
    expect(payload.html).toContain("claim_token=first");
    expect(payload.html).not.toContain("claim_token=duplicate");
    expect(idempotencyKey).toBe(`outreach-${first.id}-attempt-1`);
  });

  it("uses a distinct idempotency slot for the one scheduled follow-up", async () => {
    await sendLeadEmail({
      siteId: "site_1",
      template: "preview_ready",
      claimUrl: "https://cornershop.dev/claim/chez-lea#claim_token=first",
      actor: "operator:one",
      expectedReviewedAt: reviewedAt,
      claimInvitationId: "invitation_preview",
      dispatchAuthorization: { dispatchId: "dispatch_1", attempt: 1 },
    });
    dispatchStatus = "SENT";
    await sendLeadEmail({
      siteId: "site_1",
      template: "follow_up_1",
      claimUrl: "https://cornershop.dev/claim/chez-lea#claim_token=follow-up",
      actor: "operator:one",
      expectedReviewedAt: reviewedAt,
      claimInvitationId: "invitation_follow_up",
      dispatchAuthorization: { dispatchId: "dispatch_1", attempt: 1 },
    });

    expect(messages).toHaveLength(2);
    expect(providerSend).toHaveBeenCalledTimes(2);
  });

  it("does not call the provider when eligibility is revoked after queue", async () => {
    leadEligibilityState = "INELIGIBLE";

    await expect(
      sendLeadEmail({
        siteId: "site_1",
        template: "preview_ready",
        claimUrl:
          "https://cornershop.dev/claim/chez-lea#claim_token=must-not-send",
        to: persistedContactEmail,
        actor: "operator:one",
        expectedReviewedAt: reviewedAt,
        claimInvitationId: "invitation_preview",
        dispatchAuthorization: { dispatchId: "dispatch_1", attempt: 1 },
      }),
    ).rejects.toThrow("explicitly ineligible");

    expect(providerSend).not.toHaveBeenCalled();
    expect([...messages.values()][0]).toMatchObject({
      status: "FAILED",
      error: expect.stringContaining("explicitly ineligible"),
      providerAttemptedAt: null,
    });
  });

  it.each([
    { contact_basis: "generic corporate" },
    { contact_basis: "value-first outreach" },
    {
      channel_basis: "VERIFIED_WRITTEN_CONSENT",
      recipient: "owner@chez-lea.test",
      controller: "Corner Shop Labs Ltd",
      channel: "EMAIL",
      purpose: "CLAIM_INVITATION_AND_FOLLOW_UP",
      evidence_timestamp: "2026-08-20T09:00:00+02:00",
      evidence_source: "https://public.example.test/listing",
    },
    {
      channel_basis: "VERIFIED_WRITTEN_CONSENT",
      recipient: "owner@chez-lea.test",
      controller: "Another Controller Ltd",
      channel: "EMAIL",
      purpose: "CLAIM_INVITATION_AND_FOLLOW_UP",
      evidence_timestamp: "2026-08-20T09:00:00+02:00",
      evidence_source: "consent:other-controller-1234",
    },
    {
      channel_basis: "VERIFIED_WRITTEN_CONSENT",
      recipient: "owner@chez-lea.test",
      controller: "Corner Shop Labs Ltd",
      channel: "EMAIL",
      purpose: "CLAIM_INVITATION_AND_FOLLOW_UP",
      evidence_timestamp: "2099-08-20T09:00:00+02:00",
      evidence_source: "consent:future-evidence-1234",
    },
  ])(
    "does not call the provider for non-channel evidence",
    async (evidence) => {
      leadEligibilityEvidence = evidence as unknown as Record<string, string>;

      await expect(
        sendLeadEmail({
          siteId: "site_1",
          template: "preview_ready",
          claimUrl:
            "https://cornershop.dev/claim/chez-lea#claim_token=must-not-send",
          to: persistedContactEmail,
          actor: "operator:one",
          expectedReviewedAt: reviewedAt,
          claimInvitationId: "invitation_preview",
          dispatchAuthorization: { dispatchId: "dispatch_1", attempt: 1 },
        }),
      ).rejects.toThrow(/Electronic outreach|configured legal sender controller/);

      expect(providerSend).not.toHaveBeenCalled();
      expect([...messages.values()][0]).toMatchObject({
        status: "FAILED",
        providerAttemptedAt: null,
      });
    },
  );

  it("preserves an ambiguous queued envelope when a later pre-provider check fails", async () => {
    providerSend.mockResolvedValueOnce({
      data: null,
      error: { message: "network outcome unknown", statusCode: null },
    });
    await expect(
      sendLeadEmail({
        siteId: "site_1",
        template: "preview_ready",
        claimUrl: "https://cornershop.dev/claim/chez-lea#claim_token=stable",
        actor: "operator:one",
        expectedReviewedAt: reviewedAt,
        claimInvitationId: "invitation_preview",
        dispatchAuthorization: { dispatchId: "dispatch_1", attempt: 1 },
      }),
    ).rejects.toThrow("acceptance is unknown");

    const queued = [...messages.values()][0]!;
    queued.textBody = "original ambiguous mailbox body";
    queued.deliveryLeaseExpiresAt = new Date(0);
    outreachPaused = true;
    await expect(
      sendLeadEmail({
        siteId: "site_1",
        template: "preview_ready",
        claimUrl: "https://cornershop.dev/claim/chez-lea#claim_token=stable",
        actor: "operator:two",
        expectedReviewedAt: reviewedAt,
        claimInvitationId: "invitation_preview",
        dispatchAuthorization: { dispatchId: "dispatch_1", attempt: 1 },
      }),
    ).rejects.toThrow("acceptance is unknown");

    expect(queued).toMatchObject({
      status: "QUEUED",
      textBody: "original ambiguous mailbox body",
      providerAttemptedAt: expect.any(Date),
    });
    expect(providerSend).toHaveBeenCalledTimes(1);
  });

  it("keeps a failed-retry CAS loser non-terminal so it cannot revoke the winner's claim token", async () => {
    const now = new Date();
    messages.set("lead-outreach:site_1:preview_ready", {
      id: "failed_retry_message",
      idempotencyKey: "lead-outreach:site_1:preview_ready",
      siteId: "site_1",
      direction: "OUTBOUND",
      provider: "resend",
      providerMessageId: null,
      fromAddress: "Vincent from Restofrontapp <vincent@send.restofront.com>",
      replyToAddress: "vincent@restofront.com",
      toAddress: persistedContactEmail,
      subject: "Retryable outreach",
      textBody: "Stored",
      htmlBody: null,
      template: "preview_ready",
      status: "FAILED",
      error: "Provider rejected outreach delivery.",
      sentAt: null,
      deliveredAt: null,
      providerEventAt: null,
      providerAttemptedAt: now,
      deliveryLeaseId: null,
      deliveryLeaseExpiresAt: null,
      createdAt: now,
      updatedAt: now,
    });
    loseRetryResetCas = true;

    await expect(
      sendLeadEmail({
        siteId: "site_1",
        template: "preview_ready",
        claimUrl: "https://cornershop.dev/claim/chez-lea#claim_token=stable",
        actor: "operator:two",
        expectedReviewedAt: reviewedAt,
        claimInvitationId: "invitation_preview",
        dispatchAuthorization: { dispatchId: "dispatch_1", attempt: 2 },
      }),
    ).rejects.toMatchObject({ name: "OutreachDeliveryUnknownError" });

    expect(messages.get("lead-outreach:site_1:preview_ready")?.status).toBe(
      "FAILED",
    );
    expect(providerSend).not.toHaveBeenCalled();
  });

  it("returns the actual ID of an existing logical mailbox row", async () => {
    const now = new Date();
    messages.set("lead-outreach:site_1:preview_ready", {
      id: "legacy_random_message_id",
      idempotencyKey: "lead-outreach:site_1:preview_ready",
      siteId: "site_1",
      direction: "OUTBOUND",
      provider: "resend",
      providerMessageId: "resend_existing",
      fromAddress: "Vincent from Restofrontapp <vincent@send.restofront.com>",
      replyToAddress: "vincent@restofront.com",
      toAddress: persistedContactEmail,
      subject: "Existing outreach",
      textBody: "Stored",
      htmlBody: null,
      template: "preview_ready",
      status: "SENT",
      error: null,
      sentAt: now,
      deliveredAt: null,
      providerEventAt: null,
      providerAttemptedAt: now,
      deliveryLeaseId: null,
      deliveryLeaseExpiresAt: null,
      createdAt: now,
      updatedAt: now,
    });

    const existing = await sendLeadEmail({
      siteId: "site_1",
      template: "preview_ready",
      claimUrl: "https://cornershop.dev/claim/chez-lea#claim_token=stable",
      actor: "operator:one",
      expectedReviewedAt: reviewedAt,
      claimInvitationId: "invitation_preview",
      dispatchAuthorization: { dispatchId: "dispatch_1", attempt: 1 },
    });

    expect(existing).toEqual({
      id: "legacy_random_message_id",
      status: "SENT",
      deduplicated: true,
    });
    expect(providerSend).not.toHaveBeenCalled();
  });
});
