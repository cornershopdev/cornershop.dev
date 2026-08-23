import {
  afterAll,
  beforeEach,
  describe,
  expect,
  it,
  mock,
  spyOn,
} from "bun:test";
import { Webhook } from "svix";
import { buildInboundForwardEmail } from "@/lib/outreach-inbound-forward-policy";

const recordEvent = mock(async () => ({ handled: true, updated: 1 }));
const recordAuthEvent = mock(async () => ({ handled: true, updated: 1 }));
const recordClaimEvent = mock(async () => ({ handled: true, updated: 1 }));
const recordInboundForwardEvent = mock(
  async (): Promise<{
    handled: boolean;
    updated: number;
    reason?: "not_found" | "identity_conflict";
  }> => ({
    handled: true,
    updated: 1,
  }),
);
const captureOperatorAlert = mock(async () => "delivered" as const);

mock.module("@/lib/outreach-events", () => ({
  RESEND_OUTREACH_EVENT_TRANSITIONS: {
    "email.failed": { status: "FAILED", from: ["QUEUED", "SENT"] },
  },
  recordResendOutreachEvent: recordEvent,
}));
mock.module("@/lib/auth-delivery-events", () => ({
  RESEND_AUTH_EVENT_TRANSITIONS: {
    "email.failed": { status: "FAILED", from: ["PENDING", "SENT"] },
  },
  recordResendAuthEvent: recordAuthEvent,
}));
mock.module("@/lib/claim-delivery-events", () => ({
  RESEND_CLAIM_EVENT_TRANSITIONS: {
    "email.failed": { status: "FAILED", from: ["PENDING", "SENT"] },
  },
  recordResendClaimEvent: recordClaimEvent,
}));
mock.module("@/lib/outreach-inbound-forward-events", () => ({
  RESEND_INBOUND_FORWARD_EVENT_TRANSITIONS: {
    "email.sent": { status: "SENT", from: ["PENDING"] },
    "email.delivered": {
      status: "DELIVERED",
      from: ["PENDING", "SENT"],
    },
    "email.failed": { status: "FAILED", from: ["PENDING", "SENT"] },
    "email.suppressed": {
      status: "SUPPRESSED",
      from: ["PENDING", "SENT"],
    },
    "email.bounced": {
      status: "BOUNCED",
      from: ["PENDING", "SENT", "DELIVERED"],
    },
    "email.complained": {
      status: "COMPLAINED",
      from: ["PENDING", "SENT", "DELIVERED"],
    },
  },
  recordResendInboundForwardEvent: recordInboundForwardEvent,
}));
mock.module("@/lib/operator-alerts", () => ({ captureOperatorAlert }));

const previousDatabaseUrl = process.env.DATABASE_URL;
const previousDeliveryWebhookSecret = process.env.RESEND_WEBHOOK_SECRET;
const previousInboundWebhookSecret =
  process.env.RESEND_INBOUND_WEBHOOK_SECRET;
const deliveryWebhookSecret = `whsec_${Buffer.from(
  "test-only-delivery-webhook-signing-key",
).toString("base64")}`;
const inboundWebhookSecret = `whsec_${Buffer.from(
  "test-only-inbound-webhook-signing-key",
).toString("base64")}`;
const { POST } = await import("@/app/api/webhooks/resend/route");

describe("Resend webhook signature and delivery status", () => {
  beforeEach(() => {
    process.env.DATABASE_URL = "postgresql://unused-by-mocked-test.invalid/db";
    process.env.RESEND_WEBHOOK_SECRET = deliveryWebhookSecret;
    process.env.RESEND_INBOUND_WEBHOOK_SECRET = inboundWebhookSecret;
    recordEvent.mockClear();
    recordAuthEvent.mockClear();
    recordClaimEvent.mockClear();
    recordInboundForwardEvent.mockClear();
    captureOperatorAlert.mockClear();
  });

  afterAll(() => {
    restoreEnvironment("DATABASE_URL", previousDatabaseUrl);
    restoreEnvironment("RESEND_WEBHOOK_SECRET", previousDeliveryWebhookSecret);
    restoreEnvironment(
      "RESEND_INBOUND_WEBHOOK_SECRET",
      previousInboundWebhookSecret,
    );
  });

  it("rejects an invalid signature without mutating delivery state", async () => {
    const response = await POST(
      signedRequest({ type: "email.failed" }, "v1,invalid-signature"),
    );

    expect(response.status).toBe(400);
    expect(recordEvent).not.toHaveBeenCalled();
    expect(captureOperatorAlert).not.toHaveBeenCalled();
  });

  it("rejects a valid inbound-endpoint signature", async () => {
    const response = await POST(
      signedRequest({ type: "email.failed" }, undefined, inboundWebhookSecret),
    );

    expect(response.status).toBe(400);
    expect(recordEvent).not.toHaveBeenCalled();
  });

  it("accepts a valid signature and records a failed delivery", async () => {
    const response = await POST(signedRequest({ type: "email.failed" }));
    const payload = (await response.json()) as Record<string, unknown>;

    expect(response.status).toBe(200);
    expect(payload).toEqual({ received: true, handled: true, updated: 1 });
    expect(recordEvent).toHaveBeenCalledTimes(1);
    expect(recordEvent).toHaveBeenCalledWith({
      eventId: "webhook_message_1",
      eventType: "email.failed",
      occurredAt: expect.any(Date),
      providerMessageId: "resend_message_1",
      taggedOutreachMessageId: "outreach_message_1",
    });
  });

  it("asks Resend to retry a tagged event before its mailbox row is visible", async () => {
    recordEvent.mockResolvedValueOnce({ handled: false, updated: 0 });

    const response = await POST(signedRequest({ type: "email.failed" }));

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      error: "Outreach mailbox reservation is not visible yet",
    });
  });

  it("routes tagged authentication failures to the durable auth ledger", async () => {
    const response = await POST(
      signedRequest({ type: "email.failed", category: "auth_magic_link" }),
    );

    expect(response.status).toBe(200);
    expect(recordEvent).not.toHaveBeenCalled();
    expect(recordAuthEvent).toHaveBeenCalledWith({
      eventId: "webhook_message_1",
      eventType: "email.failed",
      occurredAt: expect.any(Date),
      providerMessageId: "resend_message_1",
      taggedAuthMagicLinkId: "auth_magic_link_1",
    });
  });

  it("asks Resend to retry an auth event before its ledger row is visible", async () => {
    recordAuthEvent.mockResolvedValueOnce({ handled: false, updated: 0 });

    const response = await POST(
      signedRequest({ type: "email.failed", category: "auth_magic_link" }),
    );

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      error: "Authentication delivery reservation is not visible yet",
    });
  });

  it("routes tagged claim failures to the durable invitation ledger", async () => {
    const response = await POST(
      signedRequest({ type: "email.failed", category: "claim_invitation" }),
    );

    expect(response.status).toBe(200);
    expect(recordEvent).not.toHaveBeenCalled();
    expect(recordAuthEvent).not.toHaveBeenCalled();
    expect(recordClaimEvent).toHaveBeenCalledWith({
      eventId: "webhook_message_1",
      eventType: "email.failed",
      occurredAt: expect.any(Date),
      providerMessageId: "resend_message_1",
      taggedClaimInvitationId: "claim_invitation_1",
    });
  });

  it("asks Resend to retry a claim event before its ledger row is visible", async () => {
    recordClaimEvent.mockResolvedValueOnce({ handled: false, updated: 0 });

    const response = await POST(
      signedRequest({ type: "email.failed", category: "claim_invitation" }),
    );

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      error: "Claim invitation delivery reservation is not visible yet",
    });
  });

  it.each([
    "email.delivered",
    "email.bounced",
    "email.failed",
    "email.suppressed",
    "email.complained",
  ] as const)(
    "routes tagged read-copy receipt %s to the durable forward ledger",
    async (eventType) => {
      const response = await POST(
        signedRequest({
          type: eventType,
          category: "outreach_inbound_forward",
        }),
      );

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        received: true,
        handled: true,
        updated: 1,
      });
      expect(recordEvent).not.toHaveBeenCalled();
      expect(recordAuthEvent).not.toHaveBeenCalled();
      expect(recordClaimEvent).not.toHaveBeenCalled();
      expect(recordInboundForwardEvent).toHaveBeenCalledWith({
        eventId: "webhook_message_1",
        eventType,
        occurredAt: expect.any(Date),
        providerMessageId: "resend_message_1",
        taggedInboundForwardId: "forward_1",
      });
    },
  );

  it("asks Resend to retry while a tagged forward reservation is not visible", async () => {
    recordInboundForwardEvent.mockResolvedValueOnce({
      handled: false,
      updated: 0,
      reason: "not_found",
    });

    const response = await POST(
      signedRequest({
        type: "email.failed",
        category: "outreach_inbound_forward",
      }),
    );

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      error: "Inbound forward delivery reservation is not visible yet",
    });
  });

  it("acknowledges a permanent forward identity conflict without retrying", async () => {
    recordInboundForwardEvent.mockResolvedValueOnce({
      handled: false,
      updated: 0,
      reason: "identity_conflict",
    });

    const response = await POST(
      signedRequest({
        type: "email.bounced",
        category: "outreach_inbound_forward",
      }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      received: true,
      handled: false,
      updated: 0,
    });
  });

  it("acknowledges a replayed forward receipt after the durable no-op", async () => {
    recordInboundForwardEvent.mockResolvedValueOnce({
      handled: true,
      updated: 0,
    });

    const response = await POST(
      signedRequest({
        type: "email.delivered",
        category: "outreach_inbound_forward",
      }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      received: true,
      handled: true,
      updated: 0,
    });
  });

  it("falls back to the provider id when the forward correlation-id tag is absent", async () => {
    const response = await POST(
      signedRequest({
        type: "email.delivered",
        category: "outreach_inbound_forward",
        omitForwardId: true,
      }),
    );

    expect(response.status).toBe(200);
    expect(recordInboundForwardEvent).toHaveBeenCalledWith(
      expect.objectContaining({ taggedInboundForwardId: undefined }),
    );
  });

  it("acknowledges unknown event types without calling a delivery recorder", async () => {
    const response = await POST(
      signedRequest({
        type: "email.delivery_delayed",
        category: "outreach_inbound_forward",
      }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ received: true, handled: false });
    expect(recordInboundForwardEvent).not.toHaveBeenCalled();
    expect(recordEvent).not.toHaveBeenCalled();
  });

  it.each([
    { created_at: "not-a-date" },
    { data: { email_id: "", tags: forwardTags() } },
    { data: { email_id: "resend_message_1", tags: [] } },
  ])("rejects malformed signed forward envelopes", async (override) => {
    const response = await POST(
      signedPayload({
        type: "email.failed",
        created_at: new Date().toISOString(),
        data: { email_id: "resend_message_1", tags: forwardTags() },
        ...override,
      }),
    );

    expect(response.status).toBe(400);
    expect(recordInboundForwardEvent).not.toHaveBeenCalled();
  });

  it("keeps mailbox content out of webhook failure logs and alerts", async () => {
    const privateDetails =
      "private mailbox body for operator@example.test and lead@example.test";
    recordInboundForwardEvent.mockRejectedValueOnce(new Error(privateDetails));
    const logged = spyOn(console, "error").mockImplementation(() => {});
    try {
      const response = await POST(
        signedRequest({
          type: "email.failed",
          category: "outreach_inbound_forward",
        }),
      );

      expect(response.status).toBe(500);
      expect(await response.json()).toEqual({
        error: "Webhook processing failed",
      });
      expect(logged).toHaveBeenCalledTimes(1);
      expect(captureOperatorAlert).toHaveBeenCalledTimes(1);
      const serialized = JSON.stringify({
        logs: logged.mock.calls,
        alerts: captureOperatorAlert.mock.calls,
      });
      expect(serialized).not.toContain(privateDetails);
      expect(serialized).not.toContain("private mailbox body");
      expect(serialized).not.toContain("operator@example.test");
      expect(serialized).not.toContain("lead@example.test");
    } finally {
      logged.mockRestore();
    }
  });
});

function signedRequest(
  input: {
    type: string;
    category?:
      | "lead_outreach"
      | "auth_magic_link"
      | "claim_invitation"
      | "outreach_inbound_forward";
    omitForwardId?: boolean;
  },
  signatureOverride?: string,
  signingSecret = deliveryWebhookSecret,
): Request {
  const timestamp = new Date();
  const messageId = "webhook_message_1";
  const body = JSON.stringify({
    type: input.type,
    created_at: timestamp.toISOString(),
    data: {
      email_id: "resend_message_1",
      tags:
        input.category === "outreach_inbound_forward"
          ? {
              ...forwardTags(),
              ...(input.omitForwardId
                ? { outreach_inbound_forward_id: undefined }
                : {}),
            }
          : {
              category: input.category ?? "lead_outreach",
              ...(input.category === "auth_magic_link"
                ? { auth_magic_link_id: "auth_magic_link_1" }
                : input.category === "claim_invitation"
                  ? { claim_invitation_id: "claim_invitation_1" }
                  : { outreach_message_id: "outreach_message_1" }),
            },
    },
  });
  const signature =
    signatureOverride ??
    new Webhook(signingSecret).sign(messageId, timestamp, body);

  return new Request("https://cornershop.dev/api/webhooks/resend", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "svix-id": messageId,
      "svix-timestamp": String(Math.floor(timestamp.getTime() / 1_000)),
      "svix-signature": signature,
    },
    body,
  });
}

function signedPayload(payload: unknown): Request {
  const timestamp = new Date();
  const messageId = "webhook_message_1";
  const body = JSON.stringify(payload);
  const signature = new Webhook(deliveryWebhookSecret).sign(
    messageId,
    timestamp,
    body,
  );
  return new Request("https://cornershop.dev/api/webhooks/resend", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "svix-id": messageId,
      "svix-timestamp": String(Math.floor(timestamp.getTime() / 1_000)),
      "svix-signature": signature,
    },
    body,
  });
}

function forwardTags(): Record<string, string> {
  const email = buildInboundForwardEmail({
    inboundForwardId: "forward_1",
    senderAddress: "Cornershopdev <vincent@send.cornershop.dev>",
    targetAddress: "operator@example.test",
    siteName: "Fixture lead",
    siteSlug: "fixture-lead",
    sourceAddress: "lead@example.test",
    originalSubject: "Re: preview",
    textBody: "Fixture body",
    outreachMessageId: "outreach_message_1",
  });
  return Object.fromEntries(
    email.tags.map(({ name, value }) => [name, value] as const),
  );
}

function restoreEnvironment(name: string, value: string | undefined) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}
