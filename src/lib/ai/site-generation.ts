import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { generateText, Output } from "ai";
import { normalizeAccountEmail } from "@/lib/account-email";
import type { ExtractedSite } from "@/lib/importer";
import { slugify } from "@/lib/site-draft";
import { siteUiLocale } from "@/lib/site-locales";
import type { RestaurantDraft } from "@/lib/restaurant";
import { applyRegeneratedRestaurantTranslation } from "@/lib/restaurant-menu-editor";
import { repairPalette } from "@/lib/source-reconstruction";
import { restaurantTranslationCandidateSchema } from "@/lib/verticals/restaurant/schema";
import { supportedCurrencySchema } from "@/lib/verticals/schema";
import type {
  VerticalConfig,
  VerticalTemplateDefinition,
} from "@/lib/verticals/types";

type SiteDraftShape<
  TAttributes extends Record<string, unknown>,
  TItemAttributes extends Record<string, unknown>,
> = {
  slug: string;
  name: string;
  eyebrow: string;
  description: string;
  address: string;
  phone: string;
  email: string;
  sourceUrl: string | null;
  logoUrl: string | null;
  faviconUrl: string | null;
  heroImageUrl: string | null;
  heroOriginalImageUrl?: string | null;
  heroImageProvenance?: "official" | "owner" | "permissioned-ugc" | null;
  palette: {
    background: string;
    foreground: string;
    accent: string;
    accentForeground: string;
  };
  sourceData: {
    navigation: NonNullable<ExtractedSite["navigation"]>;
    brandAssets: NonNullable<ExtractedSite["brandAssets"]>;
    evidence: NonNullable<ExtractedSite["evidence"]>;
  };
  attributes: TAttributes;
  autoEnhanceImages: boolean;
  defaultLocale: string;
  businessHours: Array<{ days: string; hours: string }>;
  translations: Array<{
    integrationLabels: string[];
  }>;
  catalogSections: Array<{
    items: Array<{
      available: boolean | null;
      attributes: TItemAttributes;
      imageUrl: string | null;
      originalImageUrl?: string | null;
      imageProvenance?: "official" | "owner" | "permissioned-ugc" | null;
    }>;
  }>;
  integrations: ExtractedSite["links"];
};

type PromptVerticalConfig = Pick<VerticalConfig, "prompt" | "vocabulary">;

type ImagePromptVerticalConfig = Pick<VerticalConfig, "imageEnhancement">;

export type SiteDraftGenerationDependencies = {
  generateText?: typeof generateText;
};

export const SHARED_SKELETON = `Rules:
- Never invent booking, ordering, delivery, address, phone, email, opening-hour, availability, allergen, service, or price facts.
- Existing booking, ordering, and delivery systems must remain external links; do not rename their providers.
- Preserve all factual catalog entries and prices that can be recovered.
- Put only explicitly stated opening times in businessHours; use [] when none are stated.
- Set defaultLocale to the canonical source locale using a two-letter language code.
- When the canonical locale is not English, include one complete "en" translation. When it is English, do not duplicate it in translations.
- A translation is a linguistic overlay only: its catalog sections, items and integrationLabels must have exactly the same order and counts as the canonical data.
- Never invent catalog items. If catalog data is incomplete, return an empty catalog section with a factual explanation.
- Return three accessible hex colours in palette, derived from the source website's visible branding and photography rather than a generic palette.
- Preserve sourceUrl and heroImageUrl exactly as instructed.`;

/**
 * OpenRouter is the only model provider. Text and image generation share one
 * key, so a single predicate gates both — callers degrade gracefully (text
 * falls back to `deterministicDraft`, image enhancement is skipped) rather
 * than failing the import.
 */
export function aiIsConfigured(): boolean {
  return Boolean(process.env.OPENROUTER_API_KEY);
}

export function selectSourceBackedEmail(
  reconstructedEmail: string | undefined,
  modelEmail: string | undefined,
  pageText: string,
): string {
  const reconstructed = normalizedEmail(reconstructedEmail);
  if (reconstructed) return reconstructed;
  const candidate = normalizedEmail(modelEmail);
  if (!candidate) return "";

  const sourceEmails = new Set(
    Array.from(
      pageText.matchAll(
        /(?<![a-z0-9.!#$%&'*+/=?^_`{|}~@-])[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+(?![a-z0-9@-])/gi,
      ),
      (match) => normalizedEmail(match[0]),
    ).filter((email): email is string => Boolean(email)),
  );
  return sourceEmails.has(candidate) ? candidate : "";
}

function normalizedEmail(value: string | undefined): string | null {
  if (!value) return null;
  try {
    return normalizeAccountEmail(value);
  } catch {
    return null;
  }
}

export function selectCatalogSource<T>(
  hasReconstructedCatalog: boolean,
  reconstruct: () => T,
  modelCatalog: () => T,
): T {
  return hasReconstructedCatalog ? reconstruct() : modelCatalog();
}

function getOpenRouter() {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error("OPENROUTER_API_KEY is not configured");
  return createOpenRouter({
    apiKey,
    compatibility: "strict",
    headers: {
      "HTTP-Referer":
        process.env.NEXT_PUBLIC_APP_URL ?? "https://cornershop.dev",
      "X-Title": "Cornershopdev",
    },
  });
}

/**
 * Every request carries a customer's own website content, so routing is
 * restricted to providers that neither retain nor train on the prompt.
 * `require_parameters` keeps that restriction honest: a provider that cannot
 * honour the routing preferences is skipped rather than silently substituted.
 */
const PRIVATE_ROUTING = {
  require_parameters: true,
  data_collection: "deny",
} as const;

function getTextModel() {
  return getOpenRouter().chat(
    process.env.OPENROUTER_TEXT_MODEL ?? "openrouter/auto",
    {
      extraBody: {
        provider: PRIVATE_ROUTING,
        plugins: [{ id: "response-healing" }],
      },
      usage: { include: true },
    },
  );
}

export async function regenerateRestaurantTranslation(
  draft: RestaurantDraft,
  locale: string,
): Promise<RestaurantDraft> {
  if (!aiIsConfigured()) {
    throw new Error("Translation regeneration is not configured");
  }
  const source = {
    locale: draft.defaultLocale,
    cuisine: draft.cuisine,
    eyebrow: draft.eyebrow,
    description: draft.description,
    menuSections: draft.menuSections.map((section) => ({
      name: section.name,
      description: section.description,
      items: section.items.map((item) => ({
        name: item.name,
        description: item.description,
        dietaryLabels: item.dietaryLabels,
      })),
    })),
    integrationLabels: draft.integrations.map(
      (integration) => integration.label,
    ),
  };
  const { output } = await generateText({
    model: getTextModel(),
    output: Output.object({
      schema: restaurantTranslationCandidateSchema,
      name: "restaurant_menu_translation",
      description:
        "A text-only restaurant translation with exactly the source structure.",
    }),
    maxRetries: 2,
    timeout: { totalMs: 45_000, stepMs: 35_000 },
    prompt: `Translate this restaurant copy from ${draft.defaultLocale} to ${locale}.
Return exactly the same number and order of menu sections, items, dietary-label arrays and integration labels.
Translate text only. Never add, remove, merge, split or reorder a section or item. Never invent facts.
Prices, currencies, availability and images are deliberately absent from the output contract and must remain untouched.

Canonical source:
${JSON.stringify(source)}`,
  });
  return applyRegeneratedRestaurantTranslation(draft, locale, output);
}

/**
 * Image-output models are ordinary chat models on OpenRouter: the generated
 * image comes back in `choices[].message.images[]`, which the provider maps
 * onto AI SDK file parts. `modalities` is what opts the response into that.
 *
 * `require_parameters` matters more here than for text: a provider that drops
 * `modalities` answers with prose, and `enhanceSiteImage` then throws on a
 * missing file part. Skipping such a provider turns a confusing failure into
 * the caller's existing "enhancement unavailable" path.
 */
function getImageModel(model?: string) {
  return getOpenRouter().chat(
    model ??
      process.env.PHOTO_ENHANCEMENT_MODEL ??
      process.env.OPENROUTER_IMAGE_MODEL ??
      "google/gemini-3.1-flash-image",
    {
      extraBody: {
        modalities: ["image", "text"],
        provider: PRIVATE_ROUTING,
      },
      usage: { include: true },
    },
  );
}

export function deterministicDraft<
  TAttributes extends Record<string, unknown>,
  TItemAttributes extends Record<string, unknown>,
  TTemplate extends VerticalTemplateDefinition,
  TDraft extends SiteDraftShape<TAttributes, TItemAttributes>,
>(
  source: ExtractedSite,
  vertical: VerticalConfig<TAttributes, TItemAttributes, TTemplate, TDraft>,
): TDraft {
  const name = source.name || source.source;
  const locale = source.sourceLocale ?? "en";
  const deterministicCopy =
    vertical.deterministicCopy?.[siteUiLocale(locale)];
  const verticalName = vertical.id.toLowerCase().replaceAll("_", " ");
  const catalogName =
    deterministicCopy?.catalogName ?? vertical.vocabulary.catalog;
  const description =
    source.description.length >= 20
      ? source.description
      : (deterministicCopy?.description ??
        `A private preview reconstructed from the source information currently available.`);
  const fallbackPalette = {
    ...vertical.presentation.fallbackPalette,
    accentForeground: "#ffffff",
  };
  const palette = source.palette ?? repairPalette({}, fallbackPalette);
  const catalogSections = source.catalogSections?.length
    ? source.catalogSections.map((section) => ({
        name: section.name === "Catalog" ? catalogName : section.name,
        description: section.description,
        items: section.items.map((item) => {
          const currency = supportedCurrencySchema.safeParse(item.currency);
          const sourceBackedPrice =
            item.price !== null && currency.success ? item.price : null;
          const deterministicItem = {
            ...item,
            price: sourceBackedPrice,
            currency: currency.success ? currency.data : null,
          };
          return {
            name: item.name,
            description: item.description,
            price: sourceBackedPrice,
            // Unpriced rows retain the shared draft schema's inert display
            // default, but no amount can acquire a source-unknown currency.
            currency: currency.success ? currency.data : undefined,
            available: item.availability,
            attributes:
              vertical.deterministicItemAttributes?.(deterministicItem) ??
              vertical.itemAttributeDefaults,
            imageUrl: item.imageUrl,
            originalImageUrl: item.imageUrl,
            imageProvenance: item.imageUrl ? "official" : null,
          };
        }),
      }))
    : [
        {
          name: catalogName,
          description:
            deterministicCopy?.emptyCatalogDescription ??
            `${catalogName} details were not present in deterministic source markup.`,
          items: [],
        },
      ];
  return vertical.draftSchema.parse({
    slug: slugify(name) || `${verticalName}-preview`,
    name,
    eyebrow: deterministicCopy?.eyebrow ?? `Private ${verticalName} preview`,
    description,
    address: source.address,
    phone: source.phone,
    email: source.email ?? "",
    sourceUrl: source.sourceUrl,
    logoUrl: source.logoUrl ?? null,
    faviconUrl: source.faviconUrl ?? null,
    heroImageUrl: source.heroImageUrl,
    heroOriginalImageUrl: source.heroImageUrl,
    heroImageProvenance: source.heroImageUrl ? "official" : null,
    palette,
    sourceData: {
      navigation: source.navigation ?? [],
      brandAssets: source.brandAssets ?? [],
      evidence: source.evidence ?? [],
    },
    attributes:
      vertical.deterministicAttributesFromSource?.(source) ??
      vertical.deterministicAttributes ??
      vertical.attributeDefaults,
    autoEnhanceImages: false,
    defaultLocale: locale,
    businessHours: source.businessHours ?? [],
    translations: [],
    catalogSections,
    integrations: source.links,
  });
}

export function composePrompt(
  source: ExtractedSite,
  vertical: PromptVerticalConfig,
): string {
  return `${vertical.prompt.roleFraming}

${SHARED_SKELETON}
${vertical.prompt.extractionRules}

Classification vocabulary:
${vertical.prompt.classificationVocabulary}

- Treat ${source.sourceLocale ?? "the detected source language"} as the canonical locale and put the source wording in the main fields.
- sourceUrl must be ${source.sourceUrl ?? "null"}.
- heroImageUrl must be ${source.heroImageUrl ?? "null"}.

Known business:
${JSON.stringify({
  name: source.name,
  description: source.description,
  address: source.address,
  phone: source.phone,
  sourceLocale: source.sourceLocale,
  businessTypes: source.businessTypes,
  links: source.links,
  businessHours: source.businessHours,
  email: source.email,
  navigation: source.navigation,
  catalogSections: source.catalogSections,
  evidence: source.evidence,
})}

Website text collected from the homepage and relevant same-origin pages:
${source.pageText.slice(0, 60_000)}`;
}

export async function generateSiteDraft<
  TAttributes extends Record<string, unknown>,
  TItemAttributes extends Record<string, unknown>,
  TTemplate extends VerticalTemplateDefinition,
  TDraft extends SiteDraftShape<TAttributes, TItemAttributes>,
>(
  source: ExtractedSite,
  vertical: VerticalConfig<TAttributes, TItemAttributes, TTemplate, TDraft>,
  dependencies: SiteDraftGenerationDependencies = {},
): Promise<TDraft> {
  if (
    vertical.draftGenerationStrategy === "deterministic-only" ||
    !aiIsConfigured()
  ) {
    return deterministicDraft(source, vertical);
  }

  const runGenerateText = dependencies.generateText ?? generateText;
  const { output } = await runGenerateText({
    model: getTextModel(),
    output: Output.object({
      schema: vertical.draftSchema,
      name: `${vertical.id.toLowerCase()}_website_draft`,
      description: `A faithful structured business website and ${vertical.vocabulary.catalog.toLowerCase()} draft extracted from source material.`,
    }),
    maxRetries: 2,
    timeout: { totalMs: 55_000, stepMs: 45_000 },
    prompt: composePrompt(source, vertical),
  });

  const attributes = vertical.attributesSchema.parse(output.attributes);
  const template = vertical.templates.resolve(attributes);
  const normalizedAttributes = vertical.normalizeGeneratedAttributes
    ? vertical.normalizeGeneratedAttributes(attributes, template)
    : attributes;
  const deterministic = deterministicDraft(source, vertical);
  const generated = {
    ...output,
    slug: slugify(output.name),
    sourceUrl: source.sourceUrl,
    email: selectSourceBackedEmail(source.email, output.email, source.pageText),
    logoUrl: source.logoUrl ?? null,
    faviconUrl: source.faviconUrl ?? null,
    heroImageUrl: source.heroImageUrl,
    heroOriginalImageUrl: source.heroImageUrl,
    heroImageProvenance: source.heroImageUrl ? "official" : null,
    attributes: normalizedAttributes,
    palette: repairPalette(source.palette ?? output.palette, {
      ...vertical.presentation.fallbackPalette,
      accentForeground: "#ffffff",
    }),
    sourceData: {
      navigation: source.navigation ?? [],
      brandAssets: source.brandAssets ?? [],
      evidence: source.evidence ?? [],
    },
    businessHours:
      source.businessHours && source.businessHours.length > 0
        ? source.businessHours
        : output.businessHours,
    autoEnhanceImages: true,
    catalogSections: selectCatalogSource(
      Boolean(source.catalogSections && source.catalogSections.length > 0),
      () => deterministic.catalogSections,
      () =>
        output.catalogSections.map((section) => ({
          ...section,
          items: section.items.map((item) => ({
            ...item,
            ...(vertical.normalizeGeneratedItem?.(item) ?? item),
            imageUrl: null,
            originalImageUrl: null,
            imageProvenance: null,
          })),
        })),
    ),
    integrations: source.links.length > 0 ? source.links : output.integrations,
    translations: normalizeGeneratedTranslationOverlays(
      output.translations.map((translation) => ({
        ...translation,
        integrationLabels:
          source.links.length > 0
            ? source.links.map(
                (link, index) =>
                  translation.integrationLabels[index] ?? link.label,
              )
            : translation.integrationLabels,
      })),
      vertical,
    ),
  } as TDraft;
  return vertical.draftSchema.parse(
    vertical.bindGeneratedDraftToEvidence
      ? vertical.bindGeneratedDraftToEvidence({ generated, deterministic })
      : generated,
  );
}

export function normalizeGeneratedTranslationOverlays<
  TTranslation extends { integrationLabels: string[] },
>(
  translations: TTranslation[],
  vertical: Pick<VerticalConfig, "generatedTranslationStatus">,
): TTranslation[] {
  if (!vertical.generatedTranslationStatus) return translations;
  return translations.map((translation) => ({
    ...translation,
    status: vertical.generatedTranslationStatus,
  }));
}

export type SiteImageEnhancementRequest = {
  sourceImageUrl: string;
  siteName?: string;
  enhancementNotes?: string;
  model?: string;
};

function parseSourceImageUrl(value: string): URL {
  const url = new URL(value);
  if (url.protocol !== "https:") {
    throw new Error("The source image must use HTTPS");
  }
  return url;
}

export async function enhanceSiteImage(
  request: SiteImageEnhancementRequest,
  vertical: ImagePromptVerticalConfig,
): Promise<{
  data: Uint8Array;
  mediaType: string;
  costMicros: number | null;
}> {
  if (!aiIsConfigured()) {
    throw new Error("OPENROUTER_API_KEY is not configured");
  }

  const enhancement = vertical.imageEnhancement;
  const sourceImage = parseSourceImageUrl(request.sourceImageUrl);
  const context = request.siteName
    ? `${enhancement.contextLabel}: ${request.siteName}.`
    : "";
  const notes = request.enhancementNotes
    ? `Requested finishing notes: ${request.enhancementNotes}`
    : "";
  const result = await generateText({
    model: getImageModel(request.model),
    messages: [
      {
        role: "user",
        content: [
          {
            type: "text",
            text: `Edit this exact ${enhancement.subject}. The result must remain a faithful record of the source image.

Allowed changes: correct exposure and white balance, recover highlights and shadows, reduce noise, improve sharpness and resolution, straighten, crop subtly, and remove only transient non-material distractions such as sensor dust.

Forbidden changes: never synthesize, add, remove, replace, move, restyle, or regenerate a product, food item, treatment result, person, architecture, logo, ${enhancement.forbiddenElements}, furniture, or any material scene element. Do not change camera geometry or ${enhancement.sceneClause}. If a requested adjustment would change ${enhancement.fidelityClause}, leave it unchanged. When fidelity cannot be preserved, return the source unchanged.

${enhancement.gradeClause} Return one enhanced image and no text.

${context}
${notes}`,
          },
          { type: "image", image: sourceImage },
        ],
      },
    ],
    timeout: { totalMs: 60_000 },
    experimental_include: {
      requestBody: false,
      responseBody: false,
    },
  });

  const image = result.files.find((file) =>
    file.mediaType?.startsWith("image/"),
  );
  if (!image) throw new Error("The image model returned no enhanced image");

  return {
    data: image.uint8Array,
    mediaType: image.mediaType ?? "image/png",
    costMicros: providerCostMicros(result.providerMetadata),
  };
}

export function providerCostMicros(providerMetadata: unknown): number | null {
  if (!providerMetadata || typeof providerMetadata !== "object") return null;
  for (const metadata of Object.values(
    providerMetadata as Record<string, unknown>,
  )) {
    if (!metadata || typeof metadata !== "object") continue;
    const record = metadata as Record<string, unknown>;
    const direct = record.costMicros;
    if (typeof direct === "number" && Number.isFinite(direct) && direct >= 0) {
      return Math.ceil(direct);
    }
    const usage = record.usage;
    if (!usage || typeof usage !== "object") continue;
    const cost = (usage as Record<string, unknown>).cost;
    const dollars = typeof cost === "string" ? Number(cost) : cost;
    if (typeof dollars === "number" && Number.isFinite(dollars) && dollars >= 0) {
      return Math.ceil(dollars * 1_000_000);
    }
  }
  return null;
}
