import { z } from "zod";
import {
  assertSiteDraftInvariants,
  baseSiteDraftCoreShape,
  baseSiteTranslationSchema,
  catalogItemSchema,
  catalogSectionSchema,
  integrationSchema,
  safeExternalHttpsUrlSchema,
  translatedCatalogItemSchema,
  translatedCatalogSectionSchema,
} from "@/lib/verticals/schema";
import {
  safeOptionalFoodRetailDesignProfileSchema,
  safeOptionalFoodRetailThemeSelectionSchema,
} from "@/lib/site-themes/food-retail/contracts";

export const foodShopTypeSchema = z.enum([
  "bakery",
  "patisserie",
  "butcher",
  "deli",
  "cheesemonger",
  "grocer",
  "local-food-shop",
]);

export const foodRetailAttributesSchema = z.object({
  shopType: foodShopTypeSchema.default("local-food-shop"),
  showProductImages: z.boolean().default(true),
  /** Sourced click-and-collect or pickup wording; empty means unknown. */
  pickupDetails: z.string().max(240).default(""),
  /**
   * `shopType` still picks the legacy template. The design profile and theme
   * selection are the newer, richer layer: the profile records how the shop
   * actually trades, and the selection records which registered renderer that
   * profile scored onto. Both stay safe-optional so a draft written before the
   * theme layer existed keeps parsing.
   */
  designProfile: safeOptionalFoodRetailDesignProfileSchema,
  themeSelection: safeOptionalFoodRetailThemeSelectionSchema,
});

export const foodRetailItemAttributesSchema = z
  .object({
    /**
     * Storefront inclusion is separate from shared, factual `available` state.
     * Unknown stock is deliberately the default because a product appearing in
     * a range does not prove it is in stock today.
     */
    visible: z.boolean().default(true),
    stockSourceUrl: safeExternalHttpsUrlSchema.nullable().default(null),
    /** Free text preserves source wording such as “weekends only”. */
    seasonalAvailability: z.string().max(120).default(""),
    /** Null means the source said nothing about preorder requirements. */
    preorderRequired: z.boolean().nullable().default(null),
    preorderNote: z.string().max(160).default(""),
    allergens: z.array(z.string().trim().min(1).max(40)).max(14).default([]),
    /** Required evidence whenever allergen claims are stored or rendered. */
    allergenSourceUrl: safeExternalHttpsUrlSchema.nullable().default(null),
  })
  .superRefine((attributes, context) => {
    if (attributes.allergens.length > 0 && !attributes.allergenSourceUrl) {
      context.addIssue({
        code: "custom",
        path: ["allergenSourceUrl"],
        message: "Allergen labels require a source URL",
      });
    }
  });

const translatedFoodRetailItemAttributesSchema = z.object({
  seasonalAvailability: z.string().max(120).default(""),
  preorderNote: z.string().max(160).default(""),
  allergens: z.array(z.string().trim().min(1).max(40)).max(14).default([]),
});

export const foodRetailTranslationStatusSchema = z.enum([
  "current",
  "stale",
  "draft",
]);

export const foodRetailIntegrationSchema = integrationSchema.extend({
  type: z.enum(["ordering", "delivery", "social"]),
});

const foodRetailSiteTranslationSchema = baseSiteTranslationSchema.extend({
  // Imported/generated locale copy has not been owner-reviewed merely because
  // it parsed successfully. Fixtures and reviewed owner edits opt into current.
  status: foodRetailTranslationStatusSchema.default("draft"),
  attributes: foodRetailAttributesSchema.pick({ pickupDetails: true }),
  catalogSections: z.array(
    translatedCatalogSectionSchema.extend({
      items: z.array(
        translatedCatalogItemSchema.extend({
          attributes: translatedFoodRetailItemAttributesSchema,
        }),
      ),
    }),
  ),
});

export const foodRetailSiteDraftSchema = z
  .object({
    ...baseSiteDraftCoreShape,
    attributes: foodRetailAttributesSchema,
    integrations: z.array(foodRetailIntegrationSchema).max(12),
    translations: z.array(foodRetailSiteTranslationSchema).max(8).default([]),
    catalogSections: z
      .array(
        catalogSectionSchema.extend({
          items: z
            .array(
              catalogItemSchema.extend({
                attributes: foodRetailItemAttributesSchema,
              }),
            )
            .max(40),
        }),
      )
      .min(1)
      .max(16),
  })
  .superRefine(assertSiteDraftInvariants)
  .superRefine((draft, context) => {
    if (draft.heroImageUrl && !draft.heroImageProvenance) {
      context.addIssue({
        code: "custom",
        path: ["heroImageProvenance"],
        message: "A hero image requires recorded provenance",
      });
    }
    draft.catalogSections.forEach((section, sectionIndex) => {
      section.items.forEach((item, itemIndex) => {
        if (item.available !== null && !item.attributes.stockSourceUrl) {
          context.addIssue({
            code: "custom",
            path: [
              "catalogSections",
              sectionIndex,
              "items",
              itemIndex,
              "attributes",
              "stockSourceUrl",
            ],
            message: "Stock availability claims require a source URL",
          });
        }
        if (item.available === null && item.attributes.stockSourceUrl) {
          context.addIssue({
            code: "custom",
            path: [
              "catalogSections",
              sectionIndex,
              "items",
              itemIndex,
              "attributes",
              "stockSourceUrl",
            ],
            message: "A stock source URL requires an availability claim",
          });
        }
        if (item.imageUrl && !item.imageProvenance) {
          context.addIssue({
            code: "custom",
            path: [
              "catalogSections",
              sectionIndex,
              "items",
              itemIndex,
              "imageProvenance",
            ],
            message: "A product image requires recorded provenance",
          });
        }
      });
    });
    draft.translations.forEach((translation, translationIndex) => {
      if (
        Boolean(translation.attributes.pickupDetails.trim()) !==
        Boolean(draft.attributes.pickupDetails.trim())
      ) {
        context.addIssue({
          code: "custom",
          path: [
            "translations",
            translationIndex,
            "attributes",
            "pickupDetails",
          ],
          message:
            "Translated pickup details must match the canonical claim presence",
        });
      }

      translation.catalogSections.forEach((translatedSection, sectionIndex) => {
        translatedSection.items.forEach((translatedItem, itemIndex) => {
          const canonicalItem =
            draft.catalogSections[sectionIndex]?.items[itemIndex];
          if (!canonicalItem) return;
          const translatedAttributes = translatedItem.attributes;
          const canonicalAttributes = canonicalItem.attributes;
          const attributePath = [
            "translations",
            translationIndex,
            "catalogSections",
            sectionIndex,
            "items",
            itemIndex,
            "attributes",
          ];

          if (
            Boolean(translatedAttributes.seasonalAvailability.trim()) !==
            Boolean(canonicalAttributes.seasonalAvailability.trim())
          ) {
            context.addIssue({
              code: "custom",
              path: [...attributePath, "seasonalAvailability"],
              message:
                "Translated seasonal availability must match the canonical claim presence",
            });
          }
          if (
            Boolean(translatedAttributes.preorderNote.trim()) !==
            Boolean(canonicalAttributes.preorderNote.trim())
          ) {
            context.addIssue({
              code: "custom",
              path: [...attributePath, "preorderNote"],
              message:
                "Translated preorder notes must match the canonical claim presence",
            });
          }
          if (
            translatedAttributes.allergens.length !==
              canonicalAttributes.allergens.length ||
            translatedAttributes.allergens.some(
              (allergen, allergenIndex) =>
                allergen !== canonicalAttributes.allergens[allergenIndex],
            )
          ) {
            context.addIssue({
              code: "custom",
              path: [...attributePath, "allergens"],
              message:
                "Translated allergen labels must preserve the canonical sourced facts",
            });
          }
        });
      });
    });
  });

export type FoodShopType = z.infer<typeof foodShopTypeSchema>;
export type FoodRetailAttributes = z.infer<typeof foodRetailAttributesSchema>;
export type FoodRetailItemAttributes = z.infer<
  typeof foodRetailItemAttributesSchema
>;
export type FoodRetailSiteDraft = z.infer<typeof foodRetailSiteDraftSchema>;
