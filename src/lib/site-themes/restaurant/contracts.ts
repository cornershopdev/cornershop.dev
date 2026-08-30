import { z } from "zod";

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

const hexColorSchema = z
  .string()
  .regex(/^#[0-9a-f]{6}$/i, "Use a six-digit hex colour");

const restaurantThemeStyleTokensSchema = z
  .object({
    fontPair: z.enum(["editorial", "grotesk", "condensed"]),
    density: z.enum(["airy", "balanced", "compact"]),
    radius: z.enum(["none", "soft", "round"]),
    imageTreatment: z.enum(["natural", "cinematic", "graphic"]),
  })
  .strict();

const restaurantThemeColorsSchema = z
  .object({
    background: hexColorSchema,
    foreground: hexColorSchema,
    surface: hexColorSchema,
    accent: hexColorSchema,
    accentForeground: hexColorSchema,
  })
  .strict();

export const restaurantThemeTokensSchema = z
  .object({
    colors: restaurantThemeColorsSchema,
    style: restaurantThemeStyleTokensSchema,
  })
  .strict();

export const restaurantThemeTokenOverrideSchema = z
  .object({
    colors: restaurantThemeColorsSchema.partial().strict().optional(),
    style: restaurantThemeStyleTokensSchema.partial().strict().optional(),
  })
  .strict();

const selectionReasonSchema = z
  .string()
  .trim()
  .min(1)
  .max(120)
  .regex(
    /^[\p{L}\p{N}\s.,'’&/+()-]+$/u,
    "Reasons must be plain text",
  );

export const restaurantAiThemeOutputSchema = z
  .object({
    themeId: restaurantThemeIdSchema,
    confidence: z.number().min(0).max(1),
    reasons: z.array(selectionReasonSchema).min(1).max(4),
    alternatives: z.array(restaurantThemeIdSchema).length(2),
    tokens: restaurantThemeTokenOverrideSchema.default({}),
  })
  .strict()
  .superRefine((selection, context) => {
    const ids = [selection.themeId, ...selection.alternatives];
    if (new Set(ids).size !== ids.length) {
      context.addIssue({
        code: "custom",
        path: ["alternatives"],
        message: "Theme alternatives must be unique",
      });
    }
  });

export const restaurantThemeSelectionSchema = z
  .object({
    schemaVersion: z.literal(RESTAURANT_THEME_SCHEMA_VERSION),
    themeId: restaurantThemeIdSchema,
    rendererVersion: z.literal(RESTAURANT_THEME_RENDERER_VERSION),
    source: z.enum(["ai", "deterministic", "owner"]),
    confidence: z.number().min(0).max(1),
    reasons: z.array(selectionReasonSchema).min(1).max(4),
    alternatives: z.array(restaurantThemeIdSchema).length(2),
    tokens: restaurantThemeTokensSchema,
  })
  .strict()
  .superRefine((selection, context) => {
    const ids = [selection.themeId, ...selection.alternatives];
    if (new Set(ids).size !== ids.length) {
      context.addIssue({
        code: "custom",
        path: ["alternatives"],
        message: "Theme alternatives must be unique",
      });
    }
  });

/**
 * Generation output is untrusted even after structured-output decoding. An
 * invalid theme field becomes absent so the restaurant draft can still be
 * recovered and the deterministic selector can replace just this bounded part.
 */
export const safeOptionalRestaurantDesignProfileSchema = z.preprocess(
  (value) => {
    const parsed = restaurantDesignProfileSchema.safeParse(value);
    return parsed.success ? parsed.data : undefined;
  },
  restaurantDesignProfileSchema.optional(),
);

export const safeOptionalRestaurantThemeSelectionSchema = z.preprocess(
  (value) => {
    const parsed = restaurantThemeSelectionSchema.safeParse(value);
    return parsed.success ? parsed.data : undefined;
  },
  restaurantThemeSelectionSchema.optional(),
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
