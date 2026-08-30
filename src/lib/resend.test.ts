import { describe, expect, it } from "bun:test";
import { Vertical } from "@/generated/prisma/enums";
import { emailReplyTo, emailSender } from "@/lib/email-identity";
import { restaurantMarketing } from "@/lib/verticals/restaurant/marketing";

/**
 * Who a customer hears from. Every customer arrives through a niche storefront,
 * so the niche that sold the site owns the envelope — the factory's identity
 * reaching a restaurant's inbox is the failure these cover.
 */
describe("emailSender", () => {
  it("sends as the niche that owns the site", () => {
    expect(emailSender(Vertical.RESTAURANT)).toBe(
      restaurantMarketing.email!.from,
    );
  });

  /**
   * The precedence that matters: EMAIL_FROM is a floor for niches without their
   * own verified domain, never an override. A deploy-wide value must not be able
   * to put one niche's address on another niche's mail.
   */
  it("prefers the niche's identity over the deploy-wide one", () => {
    expect(
      emailSender(Vertical.RESTAURANT, { EMAIL_FROM: "Someone <a@b.test>" }),
    ).toBe(restaurantMarketing.email!.from);
  });

  it("falls back to EMAIL_FROM for a niche that has not launched a sender", () => {
    expect(
      emailSender(Vertical.BEAUTY, { EMAIL_FROM: "Floor <a@b.test>" }),
    ).toBe("Floor <a@b.test>");
    expect(emailSender(null, { EMAIL_FROM: "Floor <a@b.test>" })).toBe(
      "Floor <a@b.test>",
    );
  });

  it("falls back to the shared domain when unset or blank", () => {
    // deploy.sh drops empty parameters, but a half-filled local `.env` would
    // otherwise hand Resend an empty `from` and fail every send.
    expect(emailSender(Vertical.BEAUTY, {})).toBe(
      "Cornershopdev <onboarding@resend.dev>",
    );
    expect(emailSender(Vertical.BEAUTY, { EMAIL_FROM: "" })).toBe(
      "Cornershopdev <onboarding@resend.dev>",
    );
  });
});

describe("emailReplyTo", () => {
  it("points replies at a mailbox the niche reads", () => {
    expect(emailReplyTo(Vertical.RESTAURANT)).toBe(
      restaurantMarketing.email!.replyTo,
    );
  });

  it("falls back to EMAIL_REPLY_TO for a niche without its own", () => {
    expect(
      emailReplyTo(Vertical.BEAUTY, {
        EMAIL_REPLY_TO: "vincent@cornershop.dev",
      }),
    ).toBe("vincent@cornershop.dev");
  });

  it("stays undefined when unset, leaving the header off", () => {
    expect(emailReplyTo(Vertical.BEAUTY, {})).toBeUndefined();
    expect(
      emailReplyTo(Vertical.BEAUTY, { EMAIL_REPLY_TO: "" }),
    ).toBeUndefined();
  });
});
