import { describe, expect, it } from "bun:test";
import {
  buildInboundForwardEmail,
  configuredOutreachInboundForwardTarget,
  dispatchInboundForwardBatch,
  inboundForwardFailureState,
  inboundForwardingConfigured,
  OUTREACH_INBOUND_FORWARD_BODY_MAX_LENGTH,
  OUTREACH_INBOUND_FORWARD_SUBJECT_MAX_LENGTH,
} from "@/lib/outreach-inbound-forward-policy";

const environment = {
  EMAIL_REPLY_TO: "vincent@reply.cornershop.dev",
};

describe("inbound read-copy forwarding policy", () => {
  it("defaults off and normalizes one configured operator mailbox", () => {
    expect(inboundForwardingConfigured({})).toBe(false);
    expect(inboundForwardingConfigured({ OUTREACH_INBOUND_FORWARD_TO: " " })).toBe(
      false,
    );
    expect(configuredOutreachInboundForwardTarget(environment)).toBeNull();
    expect(
      configuredOutreachInboundForwardTarget({
        ...environment,
        OUTREACH_INBOUND_FORWARD_TO: " Operator@Example.test ",
      }),
    ).toBe("operator@example.test");
  });

  it("rejects lists, header syntax, receiving domains, and message participants", () => {
    for (const target of [
      "Operator <operator@example.test>",
      "one@example.test,two@example.test",
      "operator@example.test\r\nBcc: victim@example.test",
      "vincent+loop@restofront.com",
      "elsewhere@reply.cornershop.dev",
    ]) {
      expect(() =>
        configuredOutreachInboundForwardTarget({
          ...environment,
          OUTREACH_INBOUND_FORWARD_TO: target,
        }),
      ).toThrow("one valid operator mailbox");
    }
    expect(() =>
      configuredOutreachInboundForwardTarget(
        {
          ...environment,
          OUTREACH_INBOUND_FORWARD_TO: "lead@example.test",
        },
        ["lead@example.test"],
      ),
    ).toThrow("one valid operator mailbox");
  });

  it("rejects a receiving domain when Reply-To uses display-name syntax", () => {
    expect(() =>
      configuredOutreachInboundForwardTarget({
        EMAIL_REPLY_TO: "Vincent <vincent@reply.cornershop.dev>",
        OUTREACH_INBOUND_FORWARD_TO: "operator@reply.cornershop.dev",
      }),
    ).toThrow("one valid operator mailbox");
  });

  it("builds a bounded plain-text read copy with lead context", () => {
    const email = buildInboundForwardEmail({
      senderAddress: "Cornershopdev <vincent@send.cornershop.dev>",
      targetAddress: "operator@example.test",
      siteName: `Chez\nLéa ${"x".repeat(150)}`,
      siteSlug: "chez-lea",
      sourceAddress: "owner@chez-lea.test",
      originalSubject: `Re: preview ${"s".repeat(300)}`,
      textBody: `Looks great\u0000\n${"b".repeat(
        OUTREACH_INBOUND_FORWARD_BODY_MAX_LENGTH,
      )}`,
      outreachMessageId: "inbound_1",
    });

    expect(email.to).toBe("operator@example.test");
    expect(email.subject.length).toBeLessThanOrEqual(
      OUTREACH_INBOUND_FORWARD_SUBJECT_MAX_LENGTH,
    );
    expect(email.subject).toContain("Chez Léa");
    expect(email.text).toContain("READ-ONLY COPY");
    expect(email.text).toContain("Reply from the Cornershopdev admin panel");
    expect(email.text).toContain("Slug: chez-lea");
    expect(email.text).toContain("From: owner@chez-lea.test");
    expect(email.text).toContain("[Read copy truncated]");
    expect(email.text).not.toContain("\u0000");
    expect(email.tags).toEqual([
      { name: "category", value: "outreach_inbound_forward" },
      { name: "outreach_message_id", value: "inbound_1" },
    ]);
    expect(email).not.toHaveProperty("html");
    expect(email).not.toHaveProperty("replyTo");
  });

  it("uses bounded retries and continues after one row raises", async () => {
    const now = new Date("2026-08-23T10:00:00.000Z");
    expect(inboundForwardFailureState(1, now)).toEqual({
      status: "PENDING",
      nextAttemptAt: new Date("2026-08-23T10:01:00.000Z"),
    });
    expect(inboundForwardFailureState(2, now)).toEqual({
      status: "PENDING",
      nextAttemptAt: new Date("2026-08-23T10:05:00.000Z"),
    });
    expect(inboundForwardFailureState(3, now)).toEqual({
      status: "EXHAUSTED",
    });

    const attempted: string[] = [];
    const outcomes = await dispatchInboundForwardBatch(
      ["forward_1", "forward_2"],
      async (id) => {
        attempted.push(id);
        if (id === "forward_1") throw new Error("fixture failure");
        return "sent";
      },
    );
    expect(attempted).toEqual(["forward_1", "forward_2"]);
    expect(outcomes.pending).toBe(1);
    expect(outcomes.sent).toBe(1);
  });
});
