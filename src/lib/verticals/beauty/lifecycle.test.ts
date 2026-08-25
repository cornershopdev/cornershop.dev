import { describe, expect, it } from "bun:test";
import { Vertical } from "@/generated/prisma/enums";
import { beautyMarketing } from "@/lib/verticals/beauty/marketing";
import { beautyConfig } from "@/lib/verticals/beauty/config";
import {
  isVerticalClaimEnabled,
  isVerticalOwnerReviewSupported,
  isVerticalPublicationEnabled,
  isVerticalPublicationMutationEnabled,
  resolveVerticalConfig,
} from "@/lib/verticals/registry";

const importStudio = await Bun.file(
  new URL("../../../app/create/import-studio.tsx", import.meta.url),
).text();
const nichePage = await Bun.file(
  new URL("../../../app/niche/[vertical]/page.tsx", import.meta.url),
).text();
const claimPage = await Bun.file(
  new URL("../../../app/claim/[slug]/page.tsx", import.meta.url),
).text();
const claimLaunchOffer = await Bun.file(
  new URL("../../claim-launch-offer.ts", import.meta.url),
).text();
const checkoutRoute = await Bun.file(
  new URL("../../../app/api/checkout/route.ts", import.meta.url),
).text();
const unsupportedDashboard = await Bun.file(
  new URL(
    "../../../app/dashboard/unsupported-vertical-dashboard.tsx",
    import.meta.url,
  ),
).text();
const dashboardPage = await Bun.file(
  new URL("../../../app/dashboard/page.tsx", import.meta.url),
).text();
const ownerSiteSave = await Bun.file(
  new URL("../../owner-site-save.ts", import.meta.url),
).text();
const claimInvitations = await Bun.file(
  new URL("../../claim-invitations.ts", import.meta.url),
).text();

const forbiddenLifecyclePromise = new RegExp(
  [
    "\\$49",
    "\\bclaim(?:s|ed|ing)?\\b",
    "\\bpay(?:ment|ing)?\\b",
    "\\bpaid\\b",
    "checkout",
    "custom[- ]domain",
    "owner editing",
    "\\bpublish(?:ing|ed)?\\b",
    "publication",
    "go live",
    "monitor(?:ing)?",
  ].join("|"),
  "i",
);

function beautyCopyBlock(source: string): string {
  const start = source.indexOf("[Vertical.BEAUTY]");
  const next = source.indexOf("[Vertical.LOCAL_SERVICE]", start);
  expect(start).toBeGreaterThan(-1);
  expect(next).toBeGreaterThan(start);
  return source.slice(start, next);
}

describe("beauty lifecycle contract", () => {
  it("keeps public preview while disabling claim and owner publication mutation", () => {
    expect(beautyConfig.claimMode).toBe("disabled");
    expect(beautyConfig.marketing.publiclyAccessible).toBe(true);
    expect(isVerticalClaimEnabled(Vertical.BEAUTY)).toBe(false);
    expect(isVerticalPublicationEnabled(Vertical.BEAUTY)).toBe(true);
    expect(isVerticalOwnerReviewSupported(Vertical.BEAUTY)).toBe(false);
    expect(isVerticalPublicationMutationEnabled(Vertical.BEAUTY)).toBe(false);
    expect(resolveVerticalConfig(Vertical.BEAUTY).marketing.pricing).toBeUndefined();
  });

  it("does not advertise claim, payment, domain, editing, publication or monitoring", () => {
    const marketingBlob = JSON.stringify(beautyMarketing);
    expect(marketingBlob).not.toMatch(forbiddenLifecyclePromise);
    expect(beautyCopyBlock(importStudio)).not.toMatch(forbiddenLifecyclePromise);
    expect(unsupportedDashboard).not.toMatch(forbiddenLifecyclePromise);
    expect(ownerSiteSave).not.toMatch(/import and claim flows/i);
    expect(ownerSiteSave).toContain(
      "Use the private preview until the vertical editor ships.",
    );
  });

  it("hides acquisition pricing on the public niche page while claiming is disabled", () => {
    expect(nichePage).toContain("isVerticalClaimEnabled(id)");
    expect(nichePage).toContain("acquisitionPricing");
    expect(nichePage).toContain('href: "#pricing"');
    expect(nichePage).toContain("<ImportForm");
    expect(beautyMarketing.form.submitLabel).toBe("Show my preview");
  });

  it("keeps claim invitations and checkout fail-closed for beauty", () => {
    expect(claimLaunchOffer).toContain(
      "if (!site || !isVerticalClaimEnabled(site.vertical))",
    );
    expect(claimLaunchOffer).toContain('kind: "not_found"');
    expect(claimPage).toContain("claimPageState");
    expect(checkoutRoute).toContain(
      "isVerticalClaimEnabled(invitation.vertical)",
    );
    expect(claimInvitations).toContain(
      "if (!isVerticalClaimEnabled(site.vertical)) throw notClaimable();",
    );
    expect(claimInvitations).toContain('"not_claimable"');
    expect(importStudio).toContain(
      "{isVerticalClaimEnabled(site.vertical) ? (",
    );
    expect(importStudio).toContain("Private pilot preview");
  });

  it("routes beauty to the unsupported dashboard instead of an owner-review workflow", () => {
    expect(dashboardPage).toContain("UnsupportedVerticalDashboard");
    expect(dashboardPage).toContain(
      "access.site.vertical !== Vertical.RESTAURANT",
    );
    expect(dashboardPage).toContain("Vertical.FOOD_RETAIL");
    expect(dashboardPage).toContain("Vertical.LOCAL_SERVICE");
    expect(unsupportedDashboard).toContain("private, non-chargeable preview");
  });
});
