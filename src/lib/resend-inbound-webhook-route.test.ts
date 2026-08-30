import { afterAll, beforeEach, describe, expect, it, mock } from "bun:test";
import { Webhook } from "svix";

const recordInbound = mock(
  async (): Promise<{
    handled: boolean;
    created: boolean;
    retry: boolean;
    siteId: string | null;
    messageId: string | null;
  }> => ({
    handled: true,
    created: true,
    retry: false,
    siteId: "site_1",
    messageId: "inbound_1",
  }),
);
const captureOperatorAlert = mock(async () => "delivered" as const);

mock.module("@/lib/outreach-inbound", () => ({
  recordInboundOutreachMessage: recordInbound,
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
const { POST } = await import("@/app/api/webhooks/resend/inbound/route");

describe("Resend inbound webhook", () => {
  beforeEach(() => {
    process.env.DATABASE_URL = "postgresql://unused-by-mocked-test.invalid/db";
    process.env.RESEND_WEBHOOK_SECRET = deliveryWebhookSecret;
    process.env.RESEND_INBOUND_WEBHOOK_SECRET = inboundWebhookSecret;
    recordInbound.mockClear();
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

  it("rejects an invalid signature without storing a reply", async () => {
    const response = await POST(signedInbound("v1,invalid-signature"));

    expect(response.status).toBe(400);
    expect(recordInbound).not.toHaveBeenCalled();
  });

  it("rejects a valid delivery-endpoint signature", async () => {
    const response = await POST(
      signedInbound(undefined, deliveryWebhookSecret),
    );

    expect(response.status).toBe(400);
    expect(recordInbound).not.toHaveBeenCalled();
  });

  it("does not fall back to the delivery secret when inbound is unconfigured", async () => {
    delete process.env.RESEND_INBOUND_WEBHOOK_SECRET;

    const response = await POST(
      signedInbound(undefined, deliveryWebhookSecret),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: "Resend webhook is not configured",
    });
    expect(recordInbound).not.toHaveBeenCalled();
    expect(captureOperatorAlert).not.toHaveBeenCalled();
  });

  it("does not send an alert when persistence is unavailable", async () => {
    delete process.env.DATABASE_URL;

    const response = await POST(signedInbound());

    expect(response.status).toBe(503);
    expect(recordInbound).not.toHaveBeenCalled();
    expect(captureOperatorAlert).not.toHaveBeenCalled();
  });

  it("stores a signed inbound reply on the matched lead thread", async () => {
    const response = await POST(signedInbound());
    const payload = (await response.json()) as Record<string, unknown>;

    expect(response.status).toBe(200);
    expect(payload).toEqual({
      received: true,
      handled: true,
      created: true,
      siteId: "site_1",
    });
    expect(recordInbound).toHaveBeenCalledTimes(1);
    expect(captureOperatorAlert).not.toHaveBeenCalled();
  });

  it("accepts unmatched genfeed mail at a root without sending an alert", async () => {
    recordInbound.mockResolvedValueOnce({
      handled: false,
      created: false,
      retry: false,
      siteId: null,
      messageId: null,
    });

    const response = await POST(
      signedInbound(undefined, inboundWebhookSecret, {
        from: "test@genfeed.ai",
        to: ["vincent@cornershop.dev"],
      }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      received: true,
      handled: false,
      created: false,
      siteId: null,
    });
    expect(captureOperatorAlert).not.toHaveBeenCalled();
  });

  it("asks Resend to retry when the received body is not visible yet", async () => {
    recordInbound.mockResolvedValueOnce({
      handled: false,
      created: false,
      retry: true,
      siteId: null,
      messageId: null,
    });

    const response = await POST(signedInbound());

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      error: "Inbound email body is not visible yet",
    });
  });

  it("logs only generic metadata when persistence fails", async () => {
    const previousConsoleError = console.error;
    const consoleError = mock(() => undefined);
    console.error = consoleError;
    recordInbound.mockImplementationOnce(async () => {
      throw new Error(
        "private mailbox body and operator@example.test must not be logged",
      );
    });
    try {
      const response = await POST(signedInbound());

      expect(response.status).toBe(500);
      expect(consoleError).toHaveBeenCalledWith(
        "[resend-inbound-webhook] processing failed",
        {
          emailId: "recv_1",
          failure: "processing_failed",
        },
      );
      const serialized = JSON.stringify(consoleError.mock.calls);
      expect(serialized).not.toContain("private mailbox body");
      expect(serialized).not.toContain("operator@example.test");
      expect(captureOperatorAlert).not.toHaveBeenCalled();
    } finally {
      console.error = previousConsoleError;
    }
  });
});

function signedInbound(
  signatureOverride?: string,
  signingSecret = inboundWebhookSecret,
  addresses: {
    from: string;
    to: string[];
  } = {
    from: "owner@chez-lea.test",
    to: ["vincent@restofront.com"],
  },
): Request {
  const timestamp = new Date();
  const messageId = "inbound_webhook_1";
  const body = JSON.stringify({
    type: "email.received",
    created_at: timestamp.toISOString(),
    data: {
      email_id: "recv_1",
      from: addresses.from,
      to: addresses.to,
      subject: "Re: your preview",
      message_id: "<reply@chez-lea.test>",
    },
  });
  const signature =
    signatureOverride ??
    new Webhook(signingSecret).sign(messageId, timestamp, body);

  return new Request("https://cornershop.dev/api/webhooks/resend/inbound", {
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

function restoreEnvironment(name: string, value: string | undefined) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}
