import { z } from "zod";

import { MOTION_PRESETS } from "@/components/motion";

/**
 * Contract for the design reference library.
 *
 * These entries describe *design direction only* — palette, type pairing,
 * layout rhythm and motion register — distilled from highly reviewed
 * commercial storefront themes. No markup, stylesheet, asset or copy is ever
 * taken from a reference, and references are never shown in customer-facing
 * UI, never presented as an affiliate relationship and never used to claim a
 * theme is "based on" a commercial product. The library exists so theme
 * authors can aim at a proven visual register instead of inventing one.
 */
export const DESIGN_REFERENCE_SCHEMA_VERSION = 1 as const;

export const designReferenceIdSchema = z.enum([
  "rosa-2",
  "osteria",
  "grand-restaurant",
  "piquant",
  "dine",
  "sydney",
  "shopify-dawn",
  "shopify-refresh",
  "shopify-sense",
  "shopify-local",
  "shopify-craft",
  "shopify-symmetry",
  "shopify-pipeline",
  "shopify-taste",
  "shopify-combine",
]);

export const designReferenceMarketplaceSchema = z.enum([
  "themeforest",
  "shopify",
]);

/**
 * The verticals a reference informs. This is deliberately the factory's own
 * vertical vocabulary rather than the marketplace's category labels.
 */
export const designReferenceVerticalSchema = z.enum([
  "restaurant",
  "beauty",
  "food-retail",
  "local-service",
]);

export const designReferenceDensitySchema = z.enum([
  "airy",
  "balanced",
  "compact",
]);

export const designReferenceImageTreatmentSchema = z.enum([
  "natural",
  "cinematic",
  "graphic",
]);

export const designReferenceTypeRegisterSchema = z.enum([
  "editorial",
  "grotesk",
  "condensed",
]);

/** Motion register is bound to the shipped primitives so it cannot drift. */
export const designReferenceMotionPresetSchema = z.enum(MOTION_PRESETS);

const hexColorSchema = z
  .string()
  .regex(/^#[0-9a-f]{6}$/, "Reference colours must be lowercase 6-digit hex");

export const designReferencePaletteSchema = z.object({
  background: hexColorSchema,
  foreground: hexColorSchema,
  surface: hexColorSchema,
  accent: hexColorSchema,
  accentForeground: hexColorSchema,
});

export const designReferenceSchema = z.object({
  id: designReferenceIdSchema,
  name: z.string().min(1),
  marketplace: designReferenceMarketplaceSchema,
  /**
   * Plain attribution used only inside the factory-internal library. Kept in
   * the same register as `marketReferences` on the shipped theme manifests.
   */
  attribution: z.string().min(1),
  summary: z.string().min(1),
  palette: designReferencePaletteSchema,
  typePairing: z.object({
    register: designReferenceTypeRegisterSchema,
    display: z.string().min(1),
    body: z.string().min(1),
  }),
  layoutRhythm: z.object({
    density: designReferenceDensitySchema,
    imageTreatment: designReferenceImageTreatmentSchema,
    note: z.string().min(1),
  }),
  motionSignature: z.object({
    preset: designReferenceMotionPresetSchema,
    durationMs: z.number().int().min(80).max(40_000),
    note: z.string().min(1),
  }),
  fitSignals: z.object({
    verticals: z.array(designReferenceVerticalSchema).min(1),
    pricePositions: z
      .array(z.enum(["value", "midmarket", "premium"]))
      .min(1),
    photographyQualities: z
      .array(z.enum(["none", "limited", "strong"]))
      .min(1),
  }),
  /** What the factory actually takes from this reference. */
  takeaway: z.string().min(1),
});

export type DesignReferenceId = z.infer<typeof designReferenceIdSchema>;
export type DesignReferenceVertical = z.infer<
  typeof designReferenceVerticalSchema
>;
export type DesignReferencePalette = z.infer<
  typeof designReferencePaletteSchema
>;
export type DesignReference = z.infer<typeof designReferenceSchema>;
