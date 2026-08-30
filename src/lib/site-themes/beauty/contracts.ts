import { z } from "zod";
import {
  createThemeSelectionSchemas,
  createThemeTokenSchemas,
  safeOptionalSchema,
} from "@/lib/site-themes/shared/contracts";

export const BEAUTY_THEME_SCHEMA_VERSION = 1 as const;
export const BEAUTY_THEME_RENDERER_VERSION = 1 as const;

/**
 * Theme ids are deliberately the existing `beautyTemplates` keys.
 *
 * The generic site renderer resolves a theme through
 * `config.templates.definitions[theme.id]`, so sharing the id space is what
 * makes a beauty theme actually change hero layout, catalog layout and section
 * classes instead of only recolouring one template. The template table stays
 * the layout contract; the theme registry adds the palette, the fit signals and
 * the customer-facing reasons on top of it.
 */
export const beautyThemeIdSchema = z.enum([
  "barbershop",
  "classic-salon",
  "modern-studio",
  "spa-luxe",
  "express-nails",
]);

export const beautyBookingModelSchema = z.enum([
  "walk-in",
  "appointment",
  "hybrid",
]);

export const beautyPrimaryIntentSchema = z.enum(["book", "call", "browse"]);

/**
 * How the service list wants to be read: a priced menu, a visual portfolio, or
 * bundled treatments. This is the beauty analogue of the restaurant menu
 * experience and it drives layout, not copy.
 */
export const beautyCatalogExperienceSchema = z.enum([
  "price-list",
  "gallery",
  "packages",
]);

export const beautyBrandTraitSchema = z.enum([
  "classic",
  "craft",
  "minimal",
  "playful",
  "energetic",
  "serene",
]);

export const beautyPricePositionSchema = z.enum([
  "value",
  "midmarket",
  "premium",
]);

export const beautyPhotographyQualitySchema = z.enum([
  "none",
  "limited",
  "strong",
]);

export const beautyDesignProfileSchema = z
  .object({
    bookingModel: beautyBookingModelSchema,
    primaryIntent: beautyPrimaryIntentSchema,
    catalogExperience: beautyCatalogExperienceSchema,
    brandTraits: z.array(beautyBrandTraitSchema).min(1).max(3),
    pricePosition: beautyPricePositionSchema,
    locationCount: z.number().int().min(1).max(50),
    photographyQuality: beautyPhotographyQualitySchema,
  })
  .strict();

const beautyThemeStyleTokensSchema = z
  .object({
    fontPair: z.enum(["editorial", "grotesk", "rounded"]),
    density: z.enum(["airy", "balanced", "compact"]),
    radius: z.enum(["none", "soft", "round"]),
    imageTreatment: z.enum(["natural", "editorial", "graphic"]),
  })
  .strict();

export const {
  tokensSchema: beautyThemeTokensSchema,
  tokenOverrideSchema: beautyThemeTokenOverrideSchema,
} = createThemeTokenSchemas(beautyThemeStyleTokensSchema);

export const {
  aiOutputSchema: beautyAiThemeOutputSchema,
  selectionSchema: beautyThemeSelectionSchema,
  safeOptionalSelectionSchema: safeOptionalBeautyThemeSelectionSchema,
} = createThemeSelectionSchemas({
  schemaVersion: BEAUTY_THEME_SCHEMA_VERSION,
  rendererVersion: BEAUTY_THEME_RENDERER_VERSION,
  themeIdSchema: beautyThemeIdSchema,
  tokensSchema: beautyThemeTokensSchema,
  tokenOverrideSchema: beautyThemeTokenOverrideSchema,
});

export const safeOptionalBeautyDesignProfileSchema = safeOptionalSchema(
  beautyDesignProfileSchema,
);

export type BeautyThemeId = z.infer<typeof beautyThemeIdSchema>;
export type BeautyBookingModel = z.infer<typeof beautyBookingModelSchema>;
export type BeautyPrimaryIntent = z.infer<typeof beautyPrimaryIntentSchema>;
export type BeautyCatalogExperience = z.infer<
  typeof beautyCatalogExperienceSchema
>;
export type BeautyBrandTrait = z.infer<typeof beautyBrandTraitSchema>;
export type BeautyPricePosition = z.infer<typeof beautyPricePositionSchema>;
export type BeautyPhotographyQuality = z.infer<
  typeof beautyPhotographyQualitySchema
>;
export type BeautyDesignProfile = z.infer<typeof beautyDesignProfileSchema>;
export type BeautyThemeTokens = z.infer<typeof beautyThemeTokensSchema>;
export type BeautyThemeTokenOverride = z.infer<
  typeof beautyThemeTokenOverrideSchema
>;
export type BeautyAiThemeOutput = z.infer<typeof beautyAiThemeOutputSchema>;
export type BeautyThemeSelection = z.infer<typeof beautyThemeSelectionSchema>;
