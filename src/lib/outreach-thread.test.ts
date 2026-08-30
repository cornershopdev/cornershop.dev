import { describe, expect, it } from "bun:test";
import { Vertical } from "@/generated/prisma/enums";
import {
  extractPlusTags,
  inboundThreadTokens,
  normalizeRfcMessageId,
  outboundRfcMessageId,
  outreachThreadKey,
  parseRfcMessageIds,
  plusAddressReplyTo,
  replySubject,
} from "@/lib/outreach-thread";

describe("outreach thread identifiers", () => {
  it("builds a stable site thread key and RFC message id", () => {
    expect(outreachThreadKey("site_1")).toBe("lead:site_1");
    expect(outboundRfcMessageId("outreach_abc")).toBe(
      "<outreach_abc@send.restofront.com>",
    );
    expect(normalizeRfcMessageId("<Outreach_ABC@send.restofront.com>")).toBe(
      "outreach_abc@send.restofront.com",
    );
  });

  it("uses the factory sender domain for an SMB without a niche domain", () => {
    expect(
      outboundRfcMessageId("outreach_trade", Vertical.LOCAL_SERVICE, {
        EMAIL_FROM: "Vincent from Cornershopdev <vincent@send.cornershop.dev>",
      }),
    ).toBe("<outreach_trade@send.cornershop.dev>");
  });

  it("parses In-Reply-To and References tokens", () => {
    expect(
      parseRfcMessageIds(
        "<outreach_abc@send.restofront.com> <other@example.test>",
      ),
    ).toEqual(["outreach_abc@send.restofront.com", "other@example.test"]);
  });

  it("extracts plus-address tags from recipients", () => {
    expect(
      extractPlusTags([
        "Vincent <vincent+chez-lea@restofront.com>",
        "vincent@restofront.com",
      ]),
    ).toEqual(["chez-lea"]);
  });

  it("collects inbound thread tokens from headers and plus-addresses", () => {
    expect(
      inboundThreadTokens({
        from: "owner@chez-lea.test",
        to: ["vincent+chez-lea@restofront.com"],
        inReplyTo: "<outreach_abc@send.restofront.com>",
        references: "<outreach_abc@send.restofront.com>",
        rfcMessageId: "<reply@owner.test>",
      }),
    ).toEqual([
      "outreach_abc@send.restofront.com",
      "reply@owner.test",
      "chez-lea",
    ]);
  });

  it("preserves the registered reply-to mailbox with a plus tag", () => {
    expect(plusAddressReplyTo("vincent@restofront.com", "chez-lea")).toBe(
      "vincent+chez-lea@restofront.com",
    );
  });

  it("prefixes reply subjects once", () => {
    expect(replySubject("Your preview")).toBe("Re: Your preview");
    expect(replySubject("Re: Your preview")).toBe("Re: Your preview");
  });
});
