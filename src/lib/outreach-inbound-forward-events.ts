import "server-only";
export {
  recordResendInboundForwardEvent,
  type InboundForwardEventRecordResult,
} from "@/lib/outreach-inbound-forward-event-recorder";
export {
  RESEND_INBOUND_FORWARD_EVENT_TRANSITIONS,
  type ResendInboundForwardEventType,
} from "@/lib/outreach-inbound-forward-event-policy";
