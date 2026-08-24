import { z } from "zod";
import { captureOperatorAlert } from "@/lib/operator-alerts";
import { recordInboundOutreachMessage } from "@/lib/outreach-inbound";
import { verifyResendWebhook } from "@/lib/resend-webhook";

export const runtime = "nodejs";

const inboundEventSchema = z.object({
  type: z.string(),
  created_at: z.string().datetime({ offset: true }),
  data: z.object({
    email_id: z.string(),
    from: z.string(),
    to: z.array(z.string()).default([]),
    subject: z.string().optional(),
    message_id: z.string().optional(),
    received_for: z.array(z.string()).optional(),
  }),
});

export async function POST(request: Request) {
  const secret = process.env.RESEND_INBOUND_WEBHOOK_SECRET;
  const rawBody = await request.text();
  const verified = verifyResendWebhook(request, rawBody, secret);
  if (!verified.ok) {
    if (verified.error === "Resend webhook is not configured") {
      await captureOperatorAlert({
        kind: "OUTREACH_SEND_FAILURE",
        dedupKey: "inbound-webhook-configuration",
        title: "Resend inbound webhook configuration is missing",
        message:
          "An inbound Resend webhook reached the application without its configured signing secret. Restore RESEND_INBOUND_WEBHOOK_SECRET and redeploy.",
        context: { category: "configuration" },
      });
    }
    return Response.json({ error: verified.error }, { status: verified.status });
  }

  const parsed = inboundEventSchema.safeParse(verified.payload);
  if (!parsed.success) {
    return Response.json({ error: "Malformed webhook payload" }, { status: 400 });
  }
  const event = parsed.data;
  if (event.type !== "email.received") {
    return Response.json({ received: true, handled: false });
  }

  if (!process.env.DATABASE_URL) {
    await captureOperatorAlert({
      kind: "OUTREACH_SEND_FAILURE",
      dedupKey: "inbound-webhook-persistence",
      title: "Resend inbound webhook persistence is unavailable",
      message:
        "A signed inbound webhook could not reach PostgreSQL. Resend will retry; restore database availability before replaying events.",
      context: { category: "database" },
    });
    return Response.json(
      { error: "Webhook persistence is unavailable" },
      { status: 503 },
    );
  }

  try {
    const result = await recordInboundOutreachMessage({
      eventId: verified.svixId,
      occurredAt: new Date(event.created_at),
      metadata: {
        emailId: event.data.email_id,
        from: event.data.from,
        to: event.data.to,
        subject: event.data.subject ?? "",
        rfcMessageId: event.data.message_id ?? null,
        receivedFor: event.data.received_for ?? [],
      },
    });
    if (result.retry) {
      return Response.json(
        { error: "Inbound email body is not visible yet" },
        { status: 503 },
      );
    }
    return Response.json({
      received: true,
      handled: result.handled,
      created: result.created,
      siteId: result.siteId,
    });
  } catch {
    console.error("[resend-inbound-webhook] processing failed", {
      emailId: event.data.email_id,
      failure: "processing_failed",
    });
    await captureOperatorAlert({
      kind: "OUTREACH_SEND_FAILURE",
      dedupKey: `inbound:${event.data.email_id}`,
      title: "Resend inbound webhook processing failed",
      message:
        "A signed inbound email returned a server failure. Inspect the outreach mailbox and application logs.",
      context: { emailId: event.data.email_id },
    });
    return Response.json(
      { error: "Webhook processing failed" },
      { status: 500 },
    );
  }
}
