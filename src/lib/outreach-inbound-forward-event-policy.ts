import type { OutreachInboundForwardDeliveryStatus } from "@/generated/prisma/enums";

export const RESEND_INBOUND_FORWARD_EVENT_TRANSITIONS = {
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
} as const satisfies Record<
  string,
  {
    status: OutreachInboundForwardDeliveryStatus;
    from: readonly OutreachInboundForwardDeliveryStatus[];
  }
>;

export type ResendInboundForwardEventType =
  keyof typeof RESEND_INBOUND_FORWARD_EVENT_TRANSITIONS;

export function inboundForwardReceiptProvesProviderAcceptance(
  eventType: ResendInboundForwardEventType,
): boolean {
  return eventType in RESEND_INBOUND_FORWARD_EVENT_TRANSITIONS;
}

export function canApplyResendInboundForwardEvent(input: {
  currentStatus: OutreachInboundForwardDeliveryStatus;
  currentEventAt: Date | null;
  eventType: ResendInboundForwardEventType;
  occurredAt: Date;
}): boolean {
  const transition = RESEND_INBOUND_FORWARD_EVENT_TRANSITIONS[input.eventType];
  return (
    transition.from.some((status) => status === input.currentStatus) &&
    (!input.currentEventAt || input.currentEventAt <= input.occurredAt)
  );
}

export function inboundForwardDeliveryFailureCode(
  eventType: ResendInboundForwardEventType,
): string | null {
  if (eventType === "email.failed") return "provider_reported_failure";
  if (eventType === "email.suppressed") return "provider_suppressed";
  if (eventType === "email.bounced") return "recipient_bounced";
  if (eventType === "email.complained") return "recipient_complained";
  return null;
}
