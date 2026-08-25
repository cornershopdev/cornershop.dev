import { describe, expect, it, mock } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

mock.module("next/navigation", () => ({
  useRouter: () => ({
    push: () => {},
    replace: () => {},
    refresh: () => {},
    back: () => {},
    prefetch: () => {},
  }),
  usePathname: () => "/dashboard",
  useSearchParams: () => new URLSearchParams(),
}));

import { FoodRetailDashboard } from "@/app/dashboard/food-retail-dashboard";
import { FACTORY_BRAND } from "@/lib/brand";
import { normalizeGeneratedTranslationOverlays } from "@/lib/ai/site-generation";
import {
  appendFoodRetailCategoryTranslations,
  appendFoodRetailIntegrationTranslations,
  appendFoodRetailItemTranslations,
  FOOD_RETAIL_NEW_LINK_LABEL,
  hasUnreviewedFoodRetailTranslations,
  markFoodRetailTranslationReviewed,
  markFoodRetailTranslationsStale,
  reconcileFoodRetailDraftAfterSave,
  updateFoodRetailTranslation,
} from "@/lib/verticals/food-retail/editor";
import { foodRetailConfig } from "@/lib/verticals/food-retail/config";
import { sampleFoodRetailDraft } from "@/lib/verticals/food-retail/fixtures";
import { foodRetailSiteDraftSchema } from "@/lib/verticals/food-retail/schema";

const sourcedCategoryName = "Owner-confirmed preserves";
const sourcedProductName = "Owner-confirmed apricot preserve";

function draftWithUiAdditions() {
  let draft = structuredClone(sampleFoodRetailDraft);
  draft.catalogSections.push({
    name: sourcedCategoryName,
    description: "",
    items: [],
  });
  draft = appendFoodRetailCategoryTranslations(draft);

  draft.catalogSections[2].items.push({
    name: sourcedProductName,
    description: "",
    price: null,
    currency: "EUR",
    available: null,
    imageUrl: null,
    attributes: {
      visible: true,
      stockSourceUrl: null,
      seasonalAvailability: "",
      preorderRequired: null,
      preorderNote: "",
      allergens: [],
      allergenSourceUrl: null,
    },
  });
  draft = appendFoodRetailItemTranslations(draft, 2);

  draft.integrations.push({
    type: "ordering",
    label: FOOD_RETAIL_NEW_LINK_LABEL,
    provider: null,
    url: "https://maison-levain.example/order",
    enabled: true,
    venueId: null,
  });
  return appendFoodRetailIntegrationTranslations(draft);
}

describe("food-retail bilingual dashboard editing", () => {
  it("keeps UI-added structures schema-valid and JSON-persistable with explicit source-copy fallbacks", () => {
    const draft = draftWithUiAdditions();
    const translation = draft.translations[0];

    expect(translation.status).toBe("stale");
    expect(translation.catalogSections[2].name).toBe(sourcedCategoryName);
    expect(translation.catalogSections[2].items[0].name).toBe(
      sourcedProductName,
    );
    expect(translation.integrationLabels.at(-1)).toBe(
      FOOD_RETAIL_NEW_LINK_LABEL,
    );

    const saved = foodRetailSiteDraftSchema.parse(
      JSON.parse(JSON.stringify(draft)),
    );
    expect(saved).toEqual(draft);
  });

  it("exposes every required localized name and label before review", () => {
    const html = renderToStaticMarkup(
      <FoodRetailDashboard
        email="owner@example.com"
        brand={FACTORY_BRAND}
        initialDraft={draftWithUiAdditions()}
        initialRevision={7}
        initiallyPublished={false}
        canSwitchWorkspace={false}
        platformUrl="https://bakery.cornershop.dev"
      />,
    );

    expect(html).toContain("FR localized copy");
    expect(html).toContain("temporarily reuse the canonical source wording");
    expect(html).toContain('aria-label="fr category 3 name"');
    expect(html).toContain('aria-label="fr product 1 name"');
    expect(html).toContain(">Link 2 label</label>");
    expect(html).not.toContain('aria-label="fr link 2 label"');
    expect(html).not.toContain('aria-label="fr product 1 allergen');
    expect(html).toContain("Sourced allergen terms remain unchanged: gluten");
    expect(html).toContain("Mark reviewed");
  });

  it("requires complete localized copy before clearing the publication gate", () => {
    let draft = draftWithUiAdditions();
    expect(hasUnreviewedFoodRetailTranslations(draft)).toBe(true);

    draft = updateFoodRetailTranslation(draft, "fr", (translation) => {
      translation.catalogSections[2].name = "Nouvelle catégorie";
      translation.catalogSections[2].items[0].name = "Nouveau produit";
      translation.integrationLabels[1] = "Commander en ligne";
    });
    expect(draft.translations[0].status).toBe("draft");

    draft = markFoodRetailTranslationReviewed(draft, "fr");
    expect(draft.translations[0].status).toBe("current");
    expect(hasUnreviewedFoodRetailTranslations(draft)).toBe(false);

    const incomplete = updateFoodRetailTranslation(
      draft,
      "fr",
      (translation) => {
        translation.catalogSections[2].items[0].name = "";
      },
    );
    expect(() => markFoodRetailTranslationReviewed(incomplete, "fr")).toThrow();
    expect(hasUnreviewedFoodRetailTranslations(incomplete)).toBe(true);
  });

  it("defaults generated translation overlays to draft until explicitly reviewed", () => {
    const generated = structuredClone(sampleFoodRetailDraft) as unknown as {
      translations: Array<Record<string, unknown>>;
    };
    delete generated.translations[0].status;

    const parsed = foodRetailSiteDraftSchema.parse(generated);
    expect(parsed.translations[0].status).toBe("draft");
    expect(hasUnreviewedFoodRetailTranslations(parsed)).toBe(true);
  });

  it("overrides a model-generated current status with draft", () => {
    const malicious = sampleFoodRetailDraft.translations.map((translation) => ({
      ...translation,
      status: "current" as const,
    }));

    const normalized = normalizeGeneratedTranslationOverlays(
      malicious,
      foodRetailConfig,
    );
    const parsed = foodRetailSiteDraftSchema.parse({
      ...sampleFoodRetailDraft,
      translations: normalized,
    });

    expect(parsed.translations[0].status).toBe("draft");
    expect(hasUnreviewedFoodRetailTranslations(parsed)).toBe(true);
  });

  it("preserves edits made while the dashboard save response is deferred", async () => {
    const submitted = structuredClone(sampleFoodRetailDraft);
    const persisted = foodRetailSiteDraftSchema.parse(submitted);
    let current = submitted;
    let releaseResponse: (() => void) | undefined;
    const deferredResponse = new Promise<void>((resolve) => {
      releaseResponse = resolve;
    });
    const completeSave = async () => {
      await deferredResponse;
      current = reconcileFoodRetailDraftAfterSave(
        submitted,
        persisted,
        current,
      );
    };

    const saving = completeSave();
    current = {
      ...submitted,
      description:
        "Typing that happened after the save request must remain in the editor.",
    };
    releaseResponse?.();
    await saving;

    expect(current.description).toContain("must remain in the editor");
  });

  it("keeps stale translations saveable when canonical claims change shape", () => {
    const edited = structuredClone(sampleFoodRetailDraft);
    edited.attributes.pickupDetails = "";
    edited.catalogSections[0].items[0].attributes.seasonalAvailability =
      "Weekends only";
    edited.catalogSections[0].items[0].attributes.preorderNote = "";
    edited.catalogSections[0].items[0].attributes.allergens.push("nuts");

    const synchronized = markFoodRetailTranslationsStale(edited);
    const translatedItem =
      synchronized.translations[0].catalogSections[0].items[0];

    expect(synchronized.translations[0].status).toBe("stale");
    expect(synchronized.translations[0].attributes.pickupDetails).toBe("");
    expect(translatedItem.attributes.seasonalAvailability).toBe(
      "Weekends only",
    );
    expect(translatedItem.attributes.preorderNote).toBe("");
    expect(translatedItem.attributes.allergens).toEqual(["gluten", "nuts"]);
    expect(foodRetailSiteDraftSchema.parse(synchronized)).toEqual(synchronized);
  });

  it("rejects a same-cardinality translated allergen substitution", () => {
    const adversarial = structuredClone(sampleFoodRetailDraft);
    adversarial.translations[0].catalogSections[0].items[0].attributes.allergens =
      ["nuts"];

    const result = foodRetailSiteDraftSchema.safeParse(adversarial);

    expect(result.success).toBeFalse();
    expect(result.error?.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          message:
            "Translated allergen labels must preserve the canonical sourced facts",
        }),
      ]),
    );
  });
});
