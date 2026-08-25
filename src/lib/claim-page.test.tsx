import { describe, expect, it } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { ClaimPanel } from "@/app/claim/[slug]/claim-panel";
import { Vertical } from "@/generated/prisma/enums";
import { claimPageState } from "@/lib/claim-launch-offer";
import { sampleSiteDraft } from "@/lib/restaurant";
import type { SiteDraftView } from "@/lib/site-draft";
import { sampleFoodRetailDraft } from "@/lib/verticals/food-retail/fixtures";
import { sampleLocalServiceSiteDraft } from "@/lib/verticals/local-service/fixtures";
import type { VerticalId } from "@/lib/verticals/types";

describe("claim page route surface", () => {
  it("renders restaurant brand and founding identity", () => {
    const { brand, html } = renderClaimRoute(
      Vertical.RESTAURANT,
      sampleSiteDraft,
    );
    expect(brand).toBe("Restofrontapp");
    expect(html).toContain("Claim Osteria Luna");
    expect(html).toContain('placeholder="owner@restaurant.com"');
    expect(html).toContain("Mobile-first website and menu");
  });

  it("renders food-retail brand and founding identity", () => {
    const { brand, html } = renderClaimRoute(
      Vertical.FOOD_RETAIL,
      sampleFoodRetailDraft,
    );
    expect(brand).toBe("Shopfront Food");
    expect(html).toContain("Claim Maison Levain");
    expect(html).toContain('placeholder="owner@shop.com"');
    expect(html).toContain("Mobile-first product ranges");
    expect(html).not.toContain("owner@restaurant.com");
    expect(html).not.toContain("Restofrontapp");
  });

  it("renders local-service brand and founding identity", () => {
    const { brand, html } = renderClaimRoute(
      Vertical.LOCAL_SERVICE,
      sampleLocalServiceSiteDraft,
    );
    expect(brand).toBe("Tradefront");
    expect(html).toContain("Claim Harbour Electrical");
    expect(html).toContain('placeholder="owner@business.com"');
    expect(html).toContain("Phone, WhatsApp and quote actions");
    expect(html).not.toContain("owner@restaurant.com");
    expect(html).not.toContain("Restofrontapp");
  });

  it("keeps beauty and missing sites behind the claim gate", () => {
    expect(
      claimPageState({
        vertical: Vertical.BEAUTY,
        draft: sampleSiteDraft,
      }).kind,
    ).toBe("not_found");
    expect(claimPageState(null).kind).toBe("not_found");
  });
});

function renderClaimRoute(vertical: VerticalId, draft: SiteDraftView) {
  const state = claimPageState({ vertical, draft });
  expect(state.kind).toBe("ready");
  if (state.kind !== "ready") throw new Error("expected a claimable site");
  return {
    brand: state.brand.name,
    html: renderToStaticMarkup(
      <ClaimPanel
        slug={draft.slug}
        vertical={state.vertical}
        fallbackDraft={state.draft}
        offer={state.offer}
        checkoutReturn={null}
      />,
    ),
  };
}
