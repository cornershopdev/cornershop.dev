import { z } from "zod";

/**
 * Vertical-agnostic theme contract factories.
 *
 * Every vertical publishes the same selection envelope: a versioned theme id,
 * a bounded confidence, plain-text reasons, exactly two alternatives, and a
 * token bag. Building those schemas once means the security-relevant rules —
 * closed token vocabulary, plain-text reasons, unique shortlist, version
 * pinning — are written and proven in one place instead of drifting across
 * four hand-copied contract modules.
 */

export const MAX_SELECTION_REASONS = 4;

/** How many alternatives a selection always names. Load-bearing: the preview
 * shortlist is `themeId` plus these, so a vertical needs three themes to be
 * selectable at all. */
export const THEME_ALTERNATIVE_COUNT = 2;

export const hexColorSchema = z
  .string()
  .regex(/^#[0-9a-f]{6}$/i, "Use a six-digit hex colour");

/**
 * The five-colour surface every vertical renders through. Keeping it shared is
 * what lets `repairThemeColorSurface` guarantee WCAG AA for all verticals with
 * a single implementation.
 */
export const themeColorsSchema = z
  .object({
    background: hexColorSchema,
    foreground: hexColorSchema,
    surface: hexColorSchema,
    accent: hexColorSchema,
    accentForeground: hexColorSchema,
  })
  .strict();

/**
 * Reasons are shown to customers on the preview, so they are plain text by
 * construction: no markup, no URLs, no CSS. A model that tries to smuggle a
 * class name or a link into a reason fails the parse and the whole selection
 * falls back to the deterministic scorer.
 */
export const selectionReasonSchema = z
  .string()
  .trim()
  .min(1)
  .max(120)
  .regex(/^[\p{L}\p{N}\s.,'’&/+()-]+$/u, "Reasons must be plain text");

/**
 * Wraps a schema so invalid input becomes `undefined` instead of throwing.
 * Generation output is untrusted even after structured-output decoding; an
 * invalid theme field should cost that field, not the whole draft.
 */
export function safeOptionalSchema<TSchema extends z.ZodTypeAny>(
  schema: TSchema,
) {
  return z.preprocess((value) => {
    const parsed = schema.safeParse(value);
    return parsed.success ? parsed.data : undefined;
  }, schema.optional());
}

/**
 * Builds the token pair for a vertical from its closed style vocabulary. The
 * override schema is deliberately the partial of the same shape: a vertical
 * cannot accept a style key it does not itself render.
 */
export function createThemeTokenSchemas<TStyle extends z.ZodObject<z.ZodRawShape>>(
  styleSchema: TStyle,
) {
  const tokensSchema = z
    .object({ colors: themeColorsSchema, style: styleSchema })
    .strict();

  const tokenOverrideSchema = z
    .object({
      colors: themeColorsSchema.partial().strict().optional(),
      style: styleSchema.partial().strict().optional(),
    })
    .strict();

  return { tokensSchema, tokenOverrideSchema };
}

/**
 * Takes `unknown` because the caller is a generic `superRefine`: the object
 * type inferred through the schema factory's type parameters is not nameable
 * here, and every schema this runs on has already validated both fields.
 */
function assertUniqueShortlist(
  selection: unknown,
  context: z.RefinementCtx,
): void {
  const { themeId, alternatives } = selection as {
    themeId: string;
    alternatives: string[];
  };
  const ids = [themeId, ...alternatives];
  if (new Set(ids).size !== ids.length) {
    context.addIssue({
      code: "custom",
      path: ["alternatives"],
      message: "Theme alternatives must be unique",
    });
  }
}

/**
 * Builds the AI-output and persisted-selection schemas for one vertical.
 *
 * The two differ only in what they trust: model output carries a token
 * *override* that is merged onto registry defaults, while a persisted
 * selection carries fully resolved tokens and pins both schema and renderer
 * versions so a stored draft can never be replayed against an incompatible
 * renderer.
 */
export function createThemeSelectionSchemas<
  TSchemaVersion extends number,
  TRendererVersion extends number,
  TThemeId extends z.ZodType<string>,
  TTokens extends z.ZodTypeAny,
  TOverride extends z.ZodTypeAny,
>(input: {
  schemaVersion: TSchemaVersion;
  rendererVersion: TRendererVersion;
  themeIdSchema: TThemeId;
  tokensSchema: TTokens;
  tokenOverrideSchema: TOverride;
}) {
  const reasons = z
    .array(selectionReasonSchema)
    .min(1)
    .max(MAX_SELECTION_REASONS);
  const alternatives = z
    .array(input.themeIdSchema)
    .length(THEME_ALTERNATIVE_COUNT);

  const aiOutputSchema = z
    .object({
      themeId: input.themeIdSchema,
      confidence: z.number().min(0).max(1),
      reasons,
      alternatives,
      /**
       * Optional rather than defaulted: the token merge treats a missing
       * override exactly like an empty one, and defaulting through a generic
       * schema would require asserting a value this factory cannot construct.
       */
      tokens: input.tokenOverrideSchema.optional(),
    })
    .strict()
    .superRefine(assertUniqueShortlist);

  const selectionSchema = z
    .object({
      schemaVersion: z.literal(input.schemaVersion),
      themeId: input.themeIdSchema,
      rendererVersion: z.literal(input.rendererVersion),
      source: z.enum(["ai", "deterministic", "owner"]),
      confidence: z.number().min(0).max(1),
      reasons,
      alternatives,
      tokens: input.tokensSchema,
    })
    .strict()
    .superRefine(assertUniqueShortlist);

  return {
    aiOutputSchema,
    selectionSchema,
    safeOptionalSelectionSchema: safeOptionalSchema(selectionSchema),
  };
}
