import { z } from "zod";
import {
  recordResendAuthEvent,
  RESEND_AUTH_EVENT_TRANSITIONS,
  type ResendAuthEventType,
} from "@/lib/auth-delivery-events";
import {
  recordResendClaimEvent,
  RESEND_CLAIM_EVENT_TRANSITIONS,
  type ResendClaimEventType,
} from "@/lib/claim-delivery-events";
import { claimDeliveryFailureCode } from "@/lib/claim-delivery-policy";
import { alertClaimInvitationDeliveryFailure } from "@/lib/billing-operator-alerts";
import { captureOperatorAlert } from "@/lib/operator-alerts";
import {
  recordResendOutreachEvent,
  RESEND_OUTREACH_EVENT_TRANSITIONS,
  type ResendOutreachEventType,
} from "@/lib/outreach-events";
import {
  recordResendInboundForwardEvent,
  RESEND_INBOUND_FORWARD_EVENT_TRANSITIONS,
  type ResendInboundForwardEventType,
} from "@/lib/outreach-inbound-forward-events";
import { verifyResendWebhook } from "@/lib/resend-webhook";

export const runtime = "nodejs";

/**
 * Resend's documented webhook envelope. Only the fields this handler reads
 * are declared; unknown event types (opened, clicked, delivery_delayed) are
 * accepted and ignored below rather than rejected, since Resend can add new
 * event types without notice.
 */
const resendEventSchema = z.object({
  type: z.string().min(1),
  created_at: z.string().datetime({ offset: true }),
  data: z.object({
    email_id: z.string().min(1),
    tags: z.record(z.string(), z.string().min(1)).optional(),
  }),
});

/**
 * Delivery-status events update the category-specific durable receipt ledger.
 * Inbound replies land on `/api/webhooks/resend/inbound`.
 */
export async function POST(request: Request) {
  const secret = process.env.RESEND_WEBHOOK_SECRET;
  const rawBody = await request.text();
  const verified = verifyResendWebhook(request, rawBody, secret);
  if (!verified.ok) {
    if (verified.error === "Resend webhook is not configured") {
      await captureOperatorAlert({
        kind: "OUTREACH_SEND_FAILURE",
        dedupKey: "webhook-configuration",
        title: "Resend webhook configuration is missing",
        message:
          "A Resend delivery webhook reached the application without a configured signing secret. Restore RESEND_WEBHOOK_SECRET and redeploy.",
        context: { category: "configuration" },
      });
    }
    return Response.json({ error: verified.error }, { status: verified.status });
  }
  const svixId = verified.svixId;

  const parsed = resendEventSchema.safeParse(verified.payload);
  if (!parsed.success) {
    return Response.json({ error: "Malformed webhook payload" }, {
      status: 400,
    });
  }
  const event = parsed.data;

  if (!process.env.DATABASE_URL) {
    await captureOperatorAlert({
      kind: "OUTREACH_SEND_FAILURE",
      dedupKey: "webhook-persistence",
      title: "Resend webhook persistence is unavailable",
      message:
        "A signed Resend webhook could not reach PostgreSQL. Resend will retry; restore database availability before replaying events.",
      context: { category: "database" },
    });
    return Response.json(
      { error: "Webhook persistence is unavailable" },
      { status: 503 },
    );
  }

  if (!isTrackedEventType(event.type)) {
    // Not a delivery-status event this handler tracks (opened, clicked,
    // delivery_delayed, or a future inbound event) — acknowledge and skip.
    return Response.json({ received: true, handled: false });
  }

  try {
    const taggedClaimInvitationId =
      event.data.tags?.category === "claim_invitation"
        ? event.data.tags.claim_invitation_id
        : undefined;
    if (taggedClaimInvitationId && isTrackedClaimEventType(event.type)) {
      const result = await recordResendClaimEvent({
        eventId: svixId,
        eventType: event.type,
        occurredAt: new Date(event.created_at),
        providerMessageId: event.data.email_id,
        taggedClaimInvitationId,
      });
      if (!result.handled) {
        return Response.json(
          { error: "Claim invitation delivery reservation is not visible yet" },
          { status: 503 },
        );
      }
      const failureCode = claimDeliveryFailureCode(event.type);
      if (result.updated > 0 && failureCode) {
        await alertClaimInvitationDeliveryFailure({
          invitationId: taggedClaimInvitationId,
          failureCode,
        });
      }
      return Response.json({
        received: true,
        handled: result.handled,
        updated: result.updated,
      });
    }

    const taggedAuthMagicLinkId =
      event.data.tags?.category === "auth_magic_link"
        ? event.data.tags.auth_magic_link_id
        : undefined;
    if (
      taggedAuthMagicLinkId &&
      isTrackedAuthEventType(event.type)
    ) {
      const result = await recordResendAuthEvent({
        eventId: svixId,
        eventType: event.type,
        occurredAt: new Date(event.created_at),
        providerMessageId: event.data.email_id,
        taggedAuthMagicLinkId,
      });
      if (!result.handled) {
        return Response.json(
          { error: "Authentication delivery reservation is not visible yet" },
          { status: 503 },
        );
      }
      return Response.json({
        received: true,
        handled: result.handled,
        updated: result.updated,
      });
    }

    if (
      event.data.tags?.category === "outreach_inbound_forward" &&
      isTrackedInboundForwardEventType(event.type)
    ) {
      const result = await recordResendInboundForwardEvent({
        eventId: svixId,
        eventType: event.type,
        occurredAt: new Date(event.created_at),
        providerMessageId: event.data.email_id,
        taggedInboundForwardId:
          event.data.tags.outreach_inbound_forward_id,
      });
      if (!result.handled && result.reason === "not_found") {
        return Response.json(
          { error: "Inbound forward delivery reservation is not visible yet" },
          { status: 503 },
        );
      }
      return Response.json({
        received: true,
        handled: result.handled,
        updated: result.updated,
      });
    }

    const taggedOutreachMessageId =
      event.data.tags?.category === "lead_outreach"
        ? event.data.tags.outreach_message_id
        : undefined;
    const result = await recordResendOutreachEvent({
      eventId: svixId,
      eventType: event.type,
      occurredAt: new Date(event.created_at),
      providerMessageId: event.data.email_id,
      taggedOutreachMessageId,
    });
    if (!result.handled && taggedOutreachMessageId) {
      // A provider can emit a signed delivery event before the transaction
      // containing its deterministic mailbox reservation commits. A 503 asks
      // Resend to retry instead of acknowledging and losing that status.
      return Response.json(
        { error: "Outreach mailbox reservation is not visible yet" },
        { status: 503 },
      );
    }
    return Response.json({
      received: true,
      handled: result.handled,
      updated: result.updated,
    });
  } catch {
    console.error("[resend-webhook] processing failed", {
      eventType: event.type,
      eventId: svixId,
    });
    await captureOperatorAlert({
      kind: "OUTREACH_SEND_FAILURE",
      dedupKey: `${event.type}:${event.data.email_id}`,
      title: "Resend webhook processing failed",
      message:
        "A signed Resend delivery event returned a server failure. Inspect the outreach mailbox, provider status, and application logs.",
      context: { eventType: event.type, emailId: event.data.email_id },
    });
    return Response.json(
      { error: "Webhook processing failed" },
      { status: 500 },
    );
  }
}

function isTrackedEventType(value: string): value is ResendOutreachEventType {
  return (
    value in RESEND_OUTREACH_EVENT_TRANSITIONS ||
    value in RESEND_AUTH_EVENT_TRANSITIONS ||
    value in RESEND_CLAIM_EVENT_TRANSITIONS ||
    value in RESEND_INBOUND_FORWARD_EVENT_TRANSITIONS
  );
}

function isTrackedAuthEventType(value: string): value is ResendAuthEventType {
  return value in RESEND_AUTH_EVENT_TRANSITIONS;
}

function isTrackedClaimEventType(value: string): value is ResendClaimEventType {
  return value in RESEND_CLAIM_EVENT_TRANSITIONS;
}

function isTrackedInboundForwardEventType(
  value: string,
): value is ResendInboundForwardEventType {
  return value in RESEND_INBOUND_FORWARD_EVENT_TRANSITIONS;
}
