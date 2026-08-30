import { z } from "zod";
import {
  assertSiteDraftInvariants,
  baseSiteDraftCoreShape,
  baseSiteTranslationSchema,
  catalogItemSchema,
  catalogSectionSchema,
  integrationSchema,
  translatedCatalogItemSchema,
  translatedCatalogSectionSchema,
} from "@/lib/verticals/schema";
import {
  safeOptionalBeautyDesignProfileSchema,
  safeOptionalBeautyThemeSelectionSchema,
} from "@/lib/site-themes/beauty/contracts";

export const beautyIntegrationSchema = integrationSchema.extend({
  type: z.enum(["booking", "social"]),
});

/**
 * Unlike the restaurant's free-text `cuisine`, the service style is a closed set.
 * Template selection is then a direct lookup instead of a regex scan over owner
 * copy, and the model has a fixed vocabulary to classify into rather than a
 * string it can phrase five different ways.
 */
export const serviceStyleSchema = z.enum([
  "barbershop",
  "classic-salon",
  "modern-studio",
  "spa-luxe",
  "express-nails",
]);

export const beautyAttributesSchema = z.object({
  serviceStyle: serviceStyleSchema.default("modern-studio"),
  showServiceImages: z.boolean().default(false),
  /**
   * `serviceStyle` still picks the template. The design profile and theme
   * selection are the newer, richer layer: the profile records what kind of
   * salon this is, and the selection records which registered renderer that
   * profile scored onto. Both stay safe-optional so a draft written before the
   * theme layer existed keeps parsing.
   */
  designProfile: safeOptionalBeautyDesignProfileSchema,
  themeSelection: safeOptionalBeautyThemeSelectionSchema,
});

export const beautyItemAttributesSchema = z.object({
  /**
   * Appointment length in minutes — the one number a service list carries that a
   * dish list does not, and the thing a customer scans for before price.
   */
  durationMinutes: z.number().int().positive().max(600).nullable().default(null),
  /** Bookable with whoever is free, rather than a named stylist. */
  anyStylist: z.boolean().default(false),
});

/**
 * Beauty has no translatable attributes: `serviceStyle` is a controlled enum the
 * renderer maps to a localized label, and duration/any-stylist are numbers and
 * booleans. So both attribute bags are empty objects in a translation, where the
 * restaurant carries `cuisine` and `dietaryLabels` through as free text.
 */
const beautySiteTranslationSchema = baseSiteTranslationSchema.extend({
  attributes: z.object({}),
  catalogSections: z.array(
    translatedCatalogSectionSchema.extend({
      items: z.array(
        translatedCatalogItemSchema.extend({ attributes: z.object({}) }),
      ),
    }),
  ),
});

export const beautySiteDraftSchema = z
  .object({
    ...baseSiteDraftCoreShape,
    attributes: beautyAttributesSchema,
    integrations: z.array(beautyIntegrationSchema).max(12),
    translations: z.array(beautySiteTranslationSchema).max(8).default([]),
    catalogSections: z
      .array(
        catalogSectionSchema.extend({
          items: z
            .array(
              catalogItemSchema.extend({
                attributes: beautyItemAttributesSchema,
              }),
            )
            .max(40),
        }),
      )
      .min(1)
      .max(12),
  })
  .superRefine(assertSiteDraftInvariants);

export type ServiceStyle = z.infer<typeof serviceStyleSchema>;
export type BeautyAttributes = z.infer<typeof beautyAttributesSchema>;
export type BeautyItemAttributes = z.infer<typeof beautyItemAttributesSchema>;
export type BeautySiteDraft = z.infer<typeof beautySiteDraftSchema>;
