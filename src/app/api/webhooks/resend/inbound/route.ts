import { z } from "zod";
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
      console.error("[resend-inbound-webhook] configuration missing", {
        failure: "signing_secret_missing",
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
    console.error("[resend-inbound-webhook] persistence unavailable", {
      failure: "database_unavailable",
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
    return Response.json(
      { error: "Webhook processing failed" },
      { status: 500 },
    );
  }
}
