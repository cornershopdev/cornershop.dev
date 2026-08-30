import { z } from "zod";
import {
  createThemeSelectionSchemas,
  createThemeTokenSchemas,
  safeOptionalSchema,
} from "@/lib/site-themes/shared/contracts";

export const FOOD_RETAIL_THEME_SCHEMA_VERSION = 1 as const;
export const FOOD_RETAIL_THEME_RENDERER_VERSION = 1 as const;

/**
 * Theme ids are deliberately the existing `foodRetailTemplates` keys.
 *
 * The generic site renderer resolves a theme through
 * `config.templates.definitions[theme.id]`, so sharing the id space is what
 * makes a food-retail theme actually change hero layout, catalog layout and
 * section classes instead of only recolouring one template. Unlike the beauty
 * vertical, no realignment was needed: the shop-type template table already
 * keys on exactly these three ids.
 */
export const foodRetailThemeIdSchema = z.enum([
  "daily-counter",
  "craft-counter",
  "market-shelves",
]);

/** How the shop actually hands product over. */
export const foodRetailFulfillmentModelSchema = z.enum([
  "counter",
  "click-collect",
  "delivery",
]);

export const foodRetailPrimaryIntentSchema = z.enum([
  "visit",
  "order",
  "browse",
]);

export const foodRetailCatalogExperienceSchema = z.enum([
  "daily-list",
  "showcase",
  "aisles",
]);

export const foodRetailBrandTraitSchema = z.enum([
  "classic",
  "craft",
  "minimal",
  "warm",
  "rustic",
  "modern",
]);

export const foodRetailPricePositionSchema = z.enum([
  "value",
  "midmarket",
  "premium",
]);

export const foodRetailPhotographyQualitySchema = z.enum([
  "none",
  "limited",
  "strong",
]);

/**
 * How fast the published range goes stale. This is the food-retail-specific
 * signal: a bakery rewrites its counter every morning, a grocer's aisles are
 * stable for months, and the two want different catalog rhythms even when
 * every other signal agrees.
 */
export const foodRetailRangeVolatilitySchema = z.enum([
  "daily",
  "seasonal",
  "stable",
]);

export const foodRetailDesignProfileSchema = z
  .object({
    fulfillmentModel: foodRetailFulfillmentModelSchema,
    primaryIntent: foodRetailPrimaryIntentSchema,
    catalogExperience: foodRetailCatalogExperienceSchema,
    brandTraits: z.array(foodRetailBrandTraitSchema).min(1).max(3),
    pricePosition: foodRetailPricePositionSchema,
    locationCount: z.number().int().min(1).max(50),
    photographyQuality: foodRetailPhotographyQualitySchema,
    rangeVolatility: foodRetailRangeVolatilitySchema,
  })
  .strict();

const foodRetailThemeStyleTokensSchema = z
  .object({
    fontPair: z.enum(["editorial", "grotesk", "rounded"]),
    density: z.enum(["airy", "balanced", "compact"]),
    radius: z.enum(["none", "soft", "round"]),
    imageTreatment: z.enum(["natural", "editorial", "graphic"]),
  })
  .strict();

export const {
  tokensSchema: foodRetailThemeTokensSchema,
  tokenOverrideSchema: foodRetailThemeTokenOverrideSchema,
} = createThemeTokenSchemas(foodRetailThemeStyleTokensSchema);

export const {
  aiOutputSchema: foodRetailAiThemeOutputSchema,
  selectionSchema: foodRetailThemeSelectionSchema,
  safeOptionalSelectionSchema: safeOptionalFoodRetailThemeSelectionSchema,
} = createThemeSelectionSchemas({
  schemaVersion: FOOD_RETAIL_THEME_SCHEMA_VERSION,
  rendererVersion: FOOD_RETAIL_THEME_RENDERER_VERSION,
  themeIdSchema: foodRetailThemeIdSchema,
  tokensSchema: foodRetailThemeTokensSchema,
  tokenOverrideSchema: foodRetailThemeTokenOverrideSchema,
});

export const safeOptionalFoodRetailDesignProfileSchema = safeOptionalSchema(
  foodRetailDesignProfileSchema,
);

export type FoodRetailThemeId = z.infer<typeof foodRetailThemeIdSchema>;
export type FoodRetailFulfillmentModel = z.infer<
  typeof foodRetailFulfillmentModelSchema
>;
export type FoodRetailPrimaryIntent = z.infer<
  typeof foodRetailPrimaryIntentSchema
>;
export type FoodRetailCatalogExperience = z.infer<
  typeof foodRetailCatalogExperienceSchema
>;
export type FoodRetailBrandTrait = z.infer<typeof foodRetailBrandTraitSchema>;
export type FoodRetailPricePosition = z.infer<
  typeof foodRetailPricePositionSchema
>;
export type FoodRetailPhotographyQuality = z.infer<
  typeof foodRetailPhotographyQualitySchema
>;
export type FoodRetailRangeVolatility = z.infer<
  typeof foodRetailRangeVolatilitySchema
>;
export type FoodRetailDesignProfile = z.infer<
  typeof foodRetailDesignProfileSchema
>;
export type FoodRetailThemeTokens = z.infer<typeof foodRetailThemeTokensSchema>;
export type FoodRetailThemeTokenOverride = z.infer<
  typeof foodRetailThemeTokenOverrideSchema
>;
export type FoodRetailAiThemeOutput = z.infer<
  typeof foodRetailAiThemeOutputSchema
>;
export type FoodRetailThemeSelection = z.infer<
  typeof foodRetailThemeSelectionSchema
>;
