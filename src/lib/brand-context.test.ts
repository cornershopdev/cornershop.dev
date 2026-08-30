import { describe, expect, it } from "bun:test";
import { Vertical } from "@/generated/prisma/enums";
import { FACTORY_BRAND } from "@/lib/brand";
import {
  brandContextForHeaders,
  brandContextForHostname,
  brandContextForSiteVertical,
  brandContextForVertical,
} from "@/lib/brand-context";
import { emailReplyTo, emailSender } from "@/lib/email-identity";
import { restaurantMarketing } from "@/lib/verticals/restaurant/marketing";

/**
 * The core resolver every other function here funnels through. A restaurant
 * that bought Restofrontapp must see Restofrontapp everywhere in the funnel —
 * name, home link and mail identity together — and cornershop.dev itself
 * must see none of it.
 */
describe("brandContextForVertical", () => {
  it("resolves a launched niche's full identity", () => {
    const context = brandContextForVertical(Vertical.RESTAURANT);
    expect(context.name).toBe(restaurantMarketing.brand.name);
    expect(context.initials).toBe(restaurantMarketing.brand.initials);
    expect(context.vertical).toBe(Vertical.RESTAURANT);
    expect(context.homeUrl).toBe(`https://${restaurantMarketing.domain}`);
    expect(context.supportEmail).toBe(restaurantMarketing.email!.replyTo);
    expect(context.fromAddress).toBe(restaurantMarketing.email!.from);
  });

  it("falls back to the factory for null, matching FACTORY_BRAND", () => {
    const context = brandContextForVertical(null);
    expect(context.name).toBe(FACTORY_BRAND.name);
    expect(context.initials).toBe(FACTORY_BRAND.initials);
    expect(context.vertical).toBeNull();
    expect(context.homeUrl).toBe("https://cornershop.dev");
    // Same fallback chain resend.ts already owns and tests; this only checks
    // brand-context did not invent a second one.
    expect(context.supportEmail).toBe(emailReplyTo(null));
    expect(context.fromAddress).toBe(emailSender(null));
  });

  it("falls back to the complete factory identity for a registered vertical with no domain yet", () => {
    // Salonfront (BEAUTY) has its own wordmark in the registry already, but no
    // launched domain. The context must not mix that wordmark with the
    // factory's URL and mailbox — it should read as Cornershopdev throughout,
    // the same as an explicit `vertical: null` request.
    const context = brandContextForVertical(Vertical.BEAUTY);
    expect(context.name).toBe(FACTORY_BRAND.name);
    expect(context.initials).toBe(FACTORY_BRAND.initials);
    expect(context.vertical).toBeNull();
    expect(context.homeUrl).toBe("https://cornershop.dev");
    expect(context.supportEmail).toBe(emailReplyTo(null));
    expect(context.fromAddress).toBe(emailSender(null));
  });
});

/**
 * The (a) half of issue #95: which niche a request's hostname belongs to,
 * reusing the registry's own hostname table rather than a second list.
 */
describe("brandContextForHostname", () => {
  it("brands a niche's own marketing domain", () => {
    expect(brandContextForHostname("restofront.com").name).toBe(
      "Restofrontapp",
    );
    expect(brandContextForHostname("www.restofront.com").vertical).toBe(
      Vertical.RESTAURANT,
    );
  });

  it("normalises case and port before matching", () => {
    expect(brandContextForHostname("RestoFront.com:443").name).toBe(
      "Restofrontapp",
    );
  });

  it("defaults to Cornershopdev on the factory's own domain", () => {
    const context = brandContextForHostname("cornershop.dev");
    expect(context.name).toBe("Cornershopdev");
    expect(context.vertical).toBeNull();
  });

  it("defaults to Cornershopdev for an unregistered hostname", () => {
    expect(brandContextForHostname("pizzeria-luigi.com").name).toBe(
      "Cornershopdev",
    );
  });
});

/**
 * Sync core behind `resolveRequestBrandContext`: takes headers as a value so
 * this stays pure and testable without a real request.
 */
describe("brandContextForHeaders", () => {
  it("prefers the forwarded host, the same precedence requestHostname uses", () => {
    const context = brandContextForHeaders(
      new Headers({
        host: "internal:3000",
        "x-forwarded-host": "restofront.com",
      }),
    );
    expect(context.name).toBe("Restofrontapp");
  });

  it("falls back to Cornershopdev when no host header is present", () => {
    expect(brandContextForHeaders(new Headers()).name).toBe("Cornershopdev");
  });
});

/**
 * The (b) half of issue #95: server code holding a `Site` (and so its
 * vertical) but no request — a claim link opened from anywhere.
 */
describe("brandContextForSiteVertical", () => {
  it("brands from the site's own vertical, not a hostname", () => {
    expect(brandContextForSiteVertical(Vertical.RESTAURANT).name).toBe(
      "Restofrontapp",
    );
  });
});
