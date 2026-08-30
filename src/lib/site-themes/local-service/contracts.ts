import { z } from "zod";
import {
  createThemeSelectionSchemas,
  createThemeTokenSchemas,
  safeOptionalSchema,
} from "@/lib/site-themes/shared/contracts";

export const LOCAL_SERVICE_THEME_SCHEMA_VERSION = 1 as const;
export const LOCAL_SERVICE_THEME_RENDERER_VERSION = 1 as const;

/** Theme ids describe presentation, never the trade itself. */
export const localServiceThemeIdSchema = z.enum([
  "direct-response",
  "trusted-local",
  "project-led",
]);

export const localServiceEngagementModelSchema = z.enum([
  "callout",
  "scheduled",
  "project",
]);

export const localServicePrimaryIntentSchema = z.enum([
  "quote",
  "contact",
  "browse",
]);

export const localServiceCatalogExperienceSchema = z.enum([
  "service-list",
  "proof-led",
  "portfolio",
]);

export const localServiceBrandTraitSchema = z.enum([
  "trusted",
  "technical",
  "craft",
  "minimal",
  "bold",
  "established",
]);

export const localServicePhotographyQualitySchema = z.enum([
  "none",
  "limited",
  "strong",
]);

export const localServiceDesignProfileSchema = z
  .object({
    engagementModel: localServiceEngagementModelSchema,
    primaryIntent: localServicePrimaryIntentSchema,
    catalogExperience: localServiceCatalogExperienceSchema,
    brandTraits: z.array(localServiceBrandTraitSchema).min(1).max(3),
    locationCount: z.number().int().min(1).max(50),
    photographyQuality: localServicePhotographyQualitySchema,
  })
  .strict();

const localServiceThemeStyleTokensSchema = z
  .object({
    fontPair: z.enum(["grotesk", "condensed", "editorial"]),
    density: z.enum(["airy", "balanced", "compact"]),
    radius: z.enum(["none", "soft", "round"]),
    imageTreatment: z.enum(["natural", "documentary", "graphic"]),
  })
  .strict();

export const {
  tokensSchema: localServiceThemeTokensSchema,
  tokenOverrideSchema: localServiceThemeTokenOverrideSchema,
} = createThemeTokenSchemas(localServiceThemeStyleTokensSchema);

export const {
  aiOutputSchema: localServiceAiThemeOutputSchema,
  selectionSchema: localServiceThemeSelectionSchema,
  safeOptionalSelectionSchema: safeOptionalLocalServiceThemeSelectionSchema,
} = createThemeSelectionSchemas({
  schemaVersion: LOCAL_SERVICE_THEME_SCHEMA_VERSION,
  rendererVersion: LOCAL_SERVICE_THEME_RENDERER_VERSION,
  themeIdSchema: localServiceThemeIdSchema,
  tokensSchema: localServiceThemeTokensSchema,
  tokenOverrideSchema: localServiceThemeTokenOverrideSchema,
});

export const safeOptionalLocalServiceDesignProfileSchema = safeOptionalSchema(
  localServiceDesignProfileSchema,
);

export type LocalServiceThemeId = z.infer<typeof localServiceThemeIdSchema>;
export type LocalServiceEngagementModel = z.infer<
  typeof localServiceEngagementModelSchema
>;
export type LocalServicePrimaryIntent = z.infer<
  typeof localServicePrimaryIntentSchema
>;
export type LocalServiceCatalogExperience = z.infer<
  typeof localServiceCatalogExperienceSchema
>;
export type LocalServiceBrandTrait = z.infer<
  typeof localServiceBrandTraitSchema
>;
export type LocalServicePhotographyQuality = z.infer<
  typeof localServicePhotographyQualitySchema
>;
export type LocalServiceDesignProfile = z.infer<
  typeof localServiceDesignProfileSchema
>;
export type LocalServiceThemeTokens = z.infer<
  typeof localServiceThemeTokensSchema
>;
export type LocalServiceThemeTokenOverride = z.infer<
  typeof localServiceThemeTokenOverrideSchema
>;
export type LocalServiceAiThemeOutput = z.infer<
  typeof localServiceAiThemeOutputSchema
>;
export type LocalServiceThemeSelection = z.infer<
  typeof localServiceThemeSelectionSchema
>;
