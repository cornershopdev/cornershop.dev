import { describe, expect, it } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { ClaimPanel } from "@/app/claim/[slug]/claim-panel";
import { Vertical } from "@/generated/prisma/enums";
import {
  resolveClaimLaunchOffer,
  type ClaimLaunchOffer,
} from "@/lib/claim-launch-offer";
import type { VerticalId } from "@/lib/verticals/types";
import { sampleSiteDraft } from "@/lib/restaurant";
import type { SiteDraftView } from "@/lib/site-draft";
import { sampleFoodRetailDraft } from "@/lib/verticals/food-retail/fixtures";
import { foodRetailMarketing } from "@/lib/verticals/food-retail/marketing";
import { sampleLocalServiceSiteDraft } from "@/lib/verticals/local-service/fixtures";
import { localServiceMarketing } from "@/lib/verticals/local-service/marketing";
import { restaurantMarketing } from "@/lib/verticals/restaurant/marketing";

describe("claim panel offer identity", () => {
  it("renders the restaurant founding offer and email example", () => {
    const html = renderPanel({
      vertical: Vertical.RESTAURANT,
      draft: sampleSiteDraft,
      offer: requireOffer(restaurantMarketing),
    });

    expect(html).toContain("Claim Osteria Luna");
    expect(html).toContain("Founding");
    expect(html).toContain("$49");
    expect(html).toContain("/month");
    expect(html).toContain("mobile-first restaurant website");
    expect(html).toContain('placeholder="owner@restaurant.com"');
    expect(html).toContain("Mobile-first website and menu");
    expect(html).not.toContain("owner@shop.com");
    expectAccessibleClaimForm(html);
  });

  it("renders the food-retail founding offer instead of restaurant copy", () => {
    const html = renderPanel({
      vertical: Vertical.FOOD_RETAIL,
      draft: sampleFoodRetailDraft,
      offer: requireOffer(foodRetailMarketing),
    });

    expect(html).toContain("Claim Maison Levain");
    expect(html).toContain("mobile-first food-retail website");
    expect(html).toContain("Mobile-first product ranges");
    expect(html).toContain('placeholder="owner@shop.com"');
    expect(html).not.toContain("owner@restaurant.com");
    expect(html).not.toContain("restaurant website");
    expect(html).not.toContain("Existing booking and ordering links");
    expectAccessibleClaimForm(html);
  });

  it("renders the local-service founding offer instead of restaurant copy", () => {
    const html = renderPanel({
      vertical: Vertical.LOCAL_SERVICE,
      draft: sampleLocalServiceSiteDraft,
      offer: requireOffer(localServiceMarketing),
    });

    expect(html).toContain("Claim Harbour Electrical");
    expect(html).toContain("complete local-service website");
    expect(html).toContain("Phone, WhatsApp and quote actions");
    expect(html).toContain('placeholder="owner@business.com"');
    expect(html).not.toContain("owner@restaurant.com");
    expect(html).not.toContain("restaurant website");
    expectAccessibleClaimForm(html);
  });

  it("fails closed with an actionable unavailable state when no launch offer exists", () => {
    const html = renderPanel({
      vertical: Vertical.FOOD_RETAIL,
      draft: sampleFoodRetailDraft,
      offer: null,
    });

    expect(html).toContain("Claiming is unavailable for Maison Levain.");
    expect(html).toContain("role=\"status\"");
    expect(html).toContain("launch offer for this site is not configured");
    expect(html).not.toContain("Founding");
    expect(html).not.toContain("$49");
    expect(html).not.toContain("owner@restaurant.com");
    expect(html).not.toContain("owner@shop.com");
    expect(html).not.toContain("Verify ownership by email");
    expect(html).not.toContain('id="claim-email"');
    expect(html).not.toContain("<form");
  });

  it("keeps Stripe return reconciliation when the offer later becomes unavailable", () => {
    const html = renderPanel({
      vertical: Vertical.FOOD_RETAIL,
      draft: sampleFoodRetailDraft,
      offer: null,
      checkoutReturn: {
        sessionId: "cs_test_123",
        claimInvitationId: "claim_123",
      },
    });

    expect(html).toContain("Payment received. Finalizing the owner account");
    expect(html).not.toContain("Claiming is unavailable");
    expect(html).not.toContain("Verify ownership by email");
  });
});

function renderPanel(input: {
  vertical: VerticalId;
  draft: SiteDraftView;
  offer: ClaimLaunchOffer | null;
  checkoutReturn?: {
    sessionId: string;
    claimInvitationId: string;
  } | null;
}) {
  return renderToStaticMarkup(
    <ClaimPanel
      slug={input.draft.slug}
      vertical={input.vertical}
      fallbackDraft={input.draft}
      offer={input.offer}
      checkoutReturn={input.checkoutReturn ?? null}
    />,
  );
}

function requireOffer(
  marketing: Parameters<typeof resolveClaimLaunchOffer>[0],
): ClaimLaunchOffer {
  const offer = resolveClaimLaunchOffer(marketing);
  expect(offer).not.toBeNull();
  return offer!;
}

function expectAccessibleClaimForm(html: string) {
  expect(html).toContain("<form");
  expect(html).toContain('type="submit"');
  const email = associatedControl(html, "Business owner email", "input");
  expect(email.id).toBe("claim-email");
  expect(attribute(email.attributes, "type")).toBe("email");
  expect(html).toContain(`id="${email.id}-description"`);
  expect(html).toContain(`for="${email.id}"`);
}

function associatedControl(
  html: string,
  label: string,
  tag: "input" | "select" | "textarea",
) {
  const labelMatch = html.match(
    new RegExp(
      `<label\\b[^>]*\\bfor="([^"]+)"[^>]*>${escapeRegex(label)}</label>`,
    ),
  );
  expect(labelMatch, `Expected a visible label named “${label}”`).not.toBeNull();
  const id = labelMatch![1];
  const control = html.match(
    new RegExp(`<${tag}\\b([^>]*\\bid="${escapeRegex(id)}"[^>]*)>`, "i"),
  );
  expect(control, `Expected <${tag} id="${id}">`).not.toBeNull();
  return { id, attributes: control![1] };
}

function attribute(attributes: string, name: string) {
  return attributes.match(new RegExp(`\\b${name}="([^"]*)"`))?.[1];
}

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
