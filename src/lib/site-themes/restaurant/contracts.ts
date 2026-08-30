import { z } from "zod";
import {
  createThemeSelectionSchemas,
  createThemeTokenSchemas,
  safeOptionalSchema,
} from "@/lib/site-themes/shared/contracts";

export const RESTAURANT_THEME_SCHEMA_VERSION = 1 as const;
export const RESTAURANT_THEME_RENDERER_VERSION = 1 as const;

export const restaurantThemeIdSchema = z.enum([
  "terroir-editorial",
  "counter-service",
  "after-dark",
  "neighborhood-table",
  "daylight-cafe",
  "family-feast",
  "vesper-room",
]);

export const restaurantServiceModelSchema = z.enum([
  "fine-dining",
  "full-service",
  "fast-casual",
  "cafe-bakery",
  "bar-nightlife",
  "takeaway",
]);

export const restaurantPrimaryIntentSchema = z.enum([
  "reserve",
  "order",
  "visit",
]);

export const restaurantMenuExperienceSchema = z.enum([
  "editorial",
  "catalog",
  "commerce",
]);

export const restaurantBrandTraitSchema = z.enum([
  "classic",
  "craft",
  "minimal",
  "playful",
  "energetic",
  "atmospheric",
]);

export const restaurantPricePositionSchema = z.enum([
  "value",
  "midmarket",
  "premium",
]);

export const restaurantPhotographyQualitySchema = z.enum([
  "none",
  "limited",
  "strong",
]);

export const restaurantDesignProfileSchema = z
  .object({
    serviceModel: restaurantServiceModelSchema,
    primaryIntent: restaurantPrimaryIntentSchema,
    menuExperience: restaurantMenuExperienceSchema,
    brandTraits: z.array(restaurantBrandTraitSchema).min(1).max(3),
    pricePosition: restaurantPricePositionSchema,
    locationCount: z.number().int().min(1).max(50),
    photographyQuality: restaurantPhotographyQualitySchema,
  })
  .strict();

const restaurantThemeStyleTokensSchema = z
  .object({
    fontPair: z.enum(["editorial", "grotesk", "condensed"]),
    density: z.enum(["airy", "balanced", "compact"]),
    radius: z.enum(["none", "soft", "round"]),
    imageTreatment: z.enum(["natural", "cinematic", "graphic"]),
  })
  .strict();

export const {
  tokensSchema: restaurantThemeTokensSchema,
  tokenOverrideSchema: restaurantThemeTokenOverrideSchema,
} = createThemeTokenSchemas(restaurantThemeStyleTokensSchema);

export const {
  aiOutputSchema: restaurantAiThemeOutputSchema,
  selectionSchema: restaurantThemeSelectionSchema,
  safeOptionalSelectionSchema: safeOptionalRestaurantThemeSelectionSchema,
} = createThemeSelectionSchemas({
  schemaVersion: RESTAURANT_THEME_SCHEMA_VERSION,
  rendererVersion: RESTAURANT_THEME_RENDERER_VERSION,
  themeIdSchema: restaurantThemeIdSchema,
  tokensSchema: restaurantThemeTokensSchema,
  tokenOverrideSchema: restaurantThemeTokenOverrideSchema,
});

/**
 * Generation output is untrusted even after structured-output decoding. An
 * invalid theme field becomes absent so the restaurant draft can still be
 * recovered and the deterministic selector can replace just this bounded part.
 */
export const safeOptionalRestaurantDesignProfileSchema = safeOptionalSchema(
  restaurantDesignProfileSchema,
);

export type RestaurantThemeId = z.infer<typeof restaurantThemeIdSchema>;
export type RestaurantServiceModel = z.infer<
  typeof restaurantServiceModelSchema
>;
export type RestaurantPrimaryIntent = z.infer<
  typeof restaurantPrimaryIntentSchema
>;
export type RestaurantMenuExperience = z.infer<
  typeof restaurantMenuExperienceSchema
>;
export type RestaurantBrandTrait = z.infer<
  typeof restaurantBrandTraitSchema
>;
export type RestaurantPricePosition = z.infer<
  typeof restaurantPricePositionSchema
>;
export type RestaurantPhotographyQuality = z.infer<
  typeof restaurantPhotographyQualitySchema
>;
export type RestaurantDesignProfile = z.infer<
  typeof restaurantDesignProfileSchema
>;
export type RestaurantThemeTokens = z.infer<
  typeof restaurantThemeTokensSchema
>;
export type RestaurantThemeTokenOverride = z.infer<
  typeof restaurantThemeTokenOverrideSchema
>;
export type RestaurantAiThemeOutput = z.infer<
  typeof restaurantAiThemeOutputSchema
>;
export type RestaurantThemeSelection = z.infer<
  typeof restaurantThemeSelectionSchema
>;
