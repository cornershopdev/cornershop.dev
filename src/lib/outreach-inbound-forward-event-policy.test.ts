import { describe, expect, it } from "bun:test";
import {
  canApplyResendInboundForwardEvent,
  inboundForwardDeliveryFailureCode,
  RESEND_INBOUND_FORWARD_EVENT_TRANSITIONS,
} from "@/lib/outreach-inbound-forward-event-policy";

describe("inbound read-copy receipt policy", () => {
  it("keeps provider receipt state separate and monotonic", () => {
    const deliveredAt = new Date("2026-08-23T10:01:00.000Z");
    expect(
      canApplyResendInboundForwardEvent({
        currentStatus: "SENT",
        currentEventAt: null,
        eventType: "email.delivered",
        occurredAt: deliveredAt,
      }),
    ).toBe(true);
    expect(
      canApplyResendInboundForwardEvent({
        currentStatus: "DELIVERED",
        currentEventAt: deliveredAt,
        eventType: "email.bounced",
        occurredAt: new Date("2026-08-23T10:02:00.000Z"),
      }),
    ).toBe(true);
    expect(
      canApplyResendInboundForwardEvent({
        currentStatus: "BOUNCED",
        currentEventAt: new Date("2026-08-23T10:02:00.000Z"),
        eventType: "email.delivered",
        occurredAt: new Date("2026-08-23T10:03:00.000Z"),
      }),
    ).toBe(false);
    expect(
      canApplyResendInboundForwardEvent({
        currentStatus: "SENT",
        currentEventAt: deliveredAt,
        eventType: "email.failed",
        occurredAt: new Date("2026-08-23T10:00:59.000Z"),
      }),
    ).toBe(false);
  });

  it("preserves distinct provider failure receipts and generic codes", () => {
    expect(RESEND_INBOUND_FORWARD_EVENT_TRANSITIONS).toMatchObject({
      "email.failed": { status: "FAILED" },
      "email.suppressed": { status: "SUPPRESSED" },
      "email.bounced": { status: "BOUNCED" },
      "email.complained": { status: "COMPLAINED" },
    });
    expect(inboundForwardDeliveryFailureCode("email.failed")).toBe(
      "provider_reported_failure",
    );
    expect(inboundForwardDeliveryFailureCode("email.suppressed")).toBe(
      "provider_suppressed",
    );
    expect(inboundForwardDeliveryFailureCode("email.bounced")).toBe(
      "recipient_bounced",
    );
    expect(inboundForwardDeliveryFailureCode("email.complained")).toBe(
      "recipient_complained",
    );
    expect(inboundForwardDeliveryFailureCode("email.delivered")).toBeNull();
  });
});
