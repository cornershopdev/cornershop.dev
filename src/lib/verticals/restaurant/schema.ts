import { z } from "zod";
import {
  assertSiteDraftInvariants,
  assertSourceNavigationDestinations,
  assertTranslationParity,
  baseSiteDraftCoreShape,
  baseSiteTranslationSchema,
  catalogItemSchema,
  catalogSectionSchema,
  integrationSchema,
  localeSchema,
  translatedCatalogItemSchema,
  translatedCatalogSectionSchema,
} from "@/lib/verticals/schema";
import {
  safeOptionalRestaurantDesignProfileSchema,
  safeOptionalRestaurantThemeSelectionSchema,
} from "@/lib/site-themes/restaurant/contracts";
import {
  findRestaurantProviderByUrl,
  restaurantProviders,
} from "@/lib/verticals/restaurant/providers";

/**
 * The engine primitives live in `@/lib/verticals/schema` so a second vertical can
 * compose them without depending on this one. They are re-exported here because
 * this module was their original home and several call sites (plus the
 * `@/lib/restaurant` shim) still import them from it.
 */
export {
  assertTranslationParity,
  baseSiteDraftSchema,
  baseSiteTranslationSchema,
  catalogItemSchema,
  catalogSectionSchema,
  imageProvenanceSchema,
  integrationSchema,
  localeSchema,
} from "@/lib/verticals/schema";

export const restaurantAttributesSchema = z.object({
  cuisine: z.string().max(80).default(""),
  showMenuImages: z.boolean().default(false),
  designProfile: safeOptionalRestaurantDesignProfileSchema,
  themeSelection: safeOptionalRestaurantThemeSelectionSchema,
});

export const restaurantItemAttributesSchema = z.object({
  dietaryLabels: z.array(z.string().max(30)).max(6).default([]),
});

export const menuItemSchema = catalogItemSchema
  .omit({ attributes: true })
  .extend(restaurantItemAttributesSchema.shape);

export const menuSectionSchema = catalogSectionSchema.extend({
  items: z.array(menuItemSchema).max(40),
});

export const restaurantIntegrationSchema = integrationSchema
  .extend({
    type: z.enum(["booking", "ordering", "delivery", "social"]),
  })
  .superRefine((integration, context) => {
    const provider = findRestaurantProviderByUrl(integration.url);
    if (provider && provider.type !== integration.type) {
      context.addIssue({
        code: "custom",
        path: ["type"],
        message: `${provider.name} links must use the ${provider.type} type`,
      });
    }
    if (
      provider &&
      integration.provider &&
      integration.provider !== provider.name
    ) {
      context.addIssue({
        code: "custom",
        path: ["provider"],
        message: `Provider must remain ${provider.name} for this URL`,
      });
    }
    if (!provider && integration.type === "social") {
      context.addIssue({
        code: "custom",
        path: ["url"],
        message: "Use an approved social provider URL",
      });
    }
    if (
      !provider &&
      integration.provider &&
      restaurantProviders.some(
        (candidate) => candidate.name === integration.provider,
      )
    ) {
      context.addIssue({
        code: "custom",
        path: ["provider"],
        message: `${integration.provider} does not match this URL`,
      });
    }
  })
  .transform((integration) => ({
    ...integration,
    provider:
      findRestaurantProviderByUrl(integration.url)?.name ??
      integration.provider,
  }));

export const restaurantTranslationStatusSchema = z.enum([
  "current",
  "stale",
  "draft",
]);

const restaurantSiteTranslationSchema = baseSiteTranslationSchema.extend({
  status: restaurantTranslationStatusSchema.default("current"),
  attributes: restaurantAttributesSchema.pick({ cuisine: true }),
  catalogSections: z.array(
    translatedCatalogSectionSchema.extend({
      items: z.array(
        translatedCatalogItemSchema.extend({
          attributes: restaurantItemAttributesSchema,
        }),
      ),
    }),
  ),
});

export const restaurantTranslationSchema = z.object({
  locale: localeSchema,
  status: restaurantTranslationStatusSchema.default("current"),
  cuisine: z.string().max(80),
  eyebrow: z.string().max(100),
  description: z.string().min(20).max(500),
  menuSections: z.array(
    z.object({
      name: z.string().min(1).max(80),
      description: z.string().max(240).default(""),
      items: z.array(
        z.object({
          name: z.string().min(1).max(120),
          description: z.string().max(320).default(""),
          dietaryLabels: z.array(z.string().max(30)).max(6).default([]),
        }),
      ),
    }),
  ),
  integrationLabels: z.array(z.string().min(1).max(60)).max(12),
});

export const restaurantTranslationCandidateSchema =
  restaurantTranslationSchema.omit({
    locale: true,
    status: true,
  });

export const restaurantSiteDraftSchema = z
  .object({
    ...baseSiteDraftCoreShape,
    attributes: restaurantAttributesSchema,
    integrations: z.array(restaurantIntegrationSchema).max(12),
    translations: z
      .array(restaurantSiteTranslationSchema)
      .max(8)
      .default([]),
    catalogSections: z
      .array(
        catalogSectionSchema.extend({
          items: z
            .array(
              catalogItemSchema.extend({
                attributes: restaurantItemAttributesSchema,
              }),
            )
            .max(40),
        }),
      )
      .min(1)
      .max(12),
  })
  .superRefine(assertSiteDraftInvariants);

export const restaurantDraftSchema = z
  .object({
    ...baseSiteDraftCoreShape,
    ...restaurantAttributesSchema.shape,
    integrations: z.array(restaurantIntegrationSchema).max(12),
    translations: z.array(restaurantTranslationSchema).max(8).default([]),
    menuSections: z.array(menuSectionSchema).min(1).max(12),
  })
  .superRefine((draft, context) => {
    assertSourceNavigationDestinations(draft, context);
    assertTranslationParity(
      {
        defaultLocale: draft.defaultLocale,
        catalogSections: draft.menuSections,
        integrations: draft.integrations,
        translations: draft.translations.map((translation) => ({
          locale: translation.locale,
          catalogSections: translation.menuSections,
          integrationLabels: translation.integrationLabels,
        })),
      },
      context,
      "menuSections",
      "menu",
    );
  });

export type RestaurantAttributes = z.infer<typeof restaurantAttributesSchema>;
export type RestaurantItemAttributes = z.infer<
  typeof restaurantItemAttributesSchema
>;
export type RestaurantDraft = z.infer<typeof restaurantDraftSchema>;
export type RestaurantTranslation = z.infer<
  typeof restaurantTranslationSchema
>;
export type RestaurantSiteDraft = z.infer<typeof restaurantSiteDraftSchema>;
export type RestaurantLocale = z.infer<typeof localeSchema>;

const sampleRestaurantFixture = restaurantDraftSchema.parse({
  slug: "osteria-luna",
  name: "Osteria Luna",
  eyebrow: "Seasonal Italian kitchen · Valletta",
  description:
    "A neighbourhood osteria serving handmade pasta, charcoal-grilled fish and the kind of long lunches that quietly become dinner.",
  cuisine: "Modern Italian",
  address: "17 Old Bakery Street, Valletta, Malta",
  phone: "+356 2123 4567",
  sourceUrl: "https://example.com",
  heroImageUrl:
    "https://images.unsplash.com/photo-1552566626-52f8b828add9?auto=format&fit=crop&w=1800&q=88",
  heroOriginalImageUrl:
    "https://images.unsplash.com/photo-1552566626-52f8b828add9?auto=format&fit=crop&w=1800&q=88",
  heroImageProvenance: "owner",
  palette: {
    background: "#f4efe5",
    foreground: "#1d241f",
    accent: "#a5482d",
  },
  showMenuImages: true,
  autoEnhanceImages: true,
  defaultLocale: "en",
  translations: [],
  menuSections: [
    {
      name: "To begin",
      description: "Small plates for the table",
      items: [
        {
          name: "House focaccia",
          description: "Rosemary, sea salt, cultured butter",
          price: 6,
          currency: "EUR",
          dietaryLabels: ["vegetarian"],
          imageUrl: null,
        },
        {
          name: "Burrata & citrus",
          description: "Blood orange, basil oil, toasted pistachio",
          price: 14,
          currency: "EUR",
          dietaryLabels: ["vegetarian", "gluten-free"],
          imageUrl:
            "https://images.unsplash.com/photo-1625943555419-56a2cb596640?auto=format&fit=crop&w=1000&q=85",
        },
      ],
    },
    {
      name: "Pasta & mains",
      description: "Made here, served when ready",
      items: [
        {
          name: "Tagliolini al limone",
          description: "Lemon, aged parmesan, black pepper",
          price: 19,
          currency: "EUR",
          dietaryLabels: ["vegetarian"],
          imageUrl:
            "https://images.unsplash.com/photo-1473093295043-cdd812d0e601?auto=format&fit=crop&w=1000&q=85",
        },
        {
          name: "Charcoal sea bass",
          description: "Braised fennel, capers, preserved lemon",
          price: 27,
          currency: "EUR",
          dietaryLabels: ["gluten-free"],
          imageUrl:
            "https://images.unsplash.com/photo-1519708227418-c8fd9a32b7a2?auto=format&fit=crop&w=1000&q=85",
        },
        {
          name: "Slow-cooked short rib",
          description: "Soft polenta, red wine jus, gremolata",
          price: 29,
          currency: "EUR",
          dietaryLabels: ["gluten-free"],
          imageUrl: null,
        },
      ],
    },
  ],
  integrations: [
    {
      type: "booking",
      label: "Book a table",
      provider: "SevenRooms",
      url: "https://www.sevenrooms.com",
    },
    {
      type: "ordering",
      label: "Order collection",
      provider: "Existing ordering",
      url: "https://osteria-luna.example/order",
    },
  ],
});

export const sampleSiteDraft: RestaurantSiteDraft =
  fromRestaurantDraft(sampleRestaurantFixture);

export const sampleRestaurant: RestaurantDraft =
  toRestaurantDraft(sampleSiteDraft);

export function toRestaurantDraft(
  draft: RestaurantSiteDraft,
): RestaurantDraft {
  return restaurantDraftSchema.parse({
    slug: draft.slug,
    name: draft.name,
    eyebrow: draft.eyebrow,
    description: draft.description,
    cuisine: draft.attributes.cuisine,
    designProfile: draft.attributes.designProfile,
    themeSelection: draft.attributes.themeSelection,
    address: draft.address,
    phone: draft.phone,
    email: draft.email,
    sourceUrl: draft.sourceUrl,
    logoUrl: draft.logoUrl,
    faviconUrl: draft.faviconUrl,
    heroImageUrl: draft.heroImageUrl,
    heroOriginalImageUrl: draft.heroOriginalImageUrl,
    heroImageProvenance: draft.heroImageProvenance,
    galleryImages: draft.galleryImages,
    palette: draft.palette,
    sourceData: draft.sourceData,
    showMenuImages: draft.attributes.showMenuImages,
    autoEnhanceImages: draft.autoEnhanceImages,
    defaultLocale: draft.defaultLocale,
    businessHours: draft.businessHours,
    translations: draft.translations.map((translation) => ({
      locale: translation.locale,
      status: translation.status,
      cuisine: translation.attributes.cuisine,
      eyebrow: translation.eyebrow,
      description: translation.description,
      menuSections: translation.catalogSections.map((section) => ({
        name: section.name,
        description: section.description,
        items: section.items.map((item) => ({
          name: item.name,
          description: item.description,
          dietaryLabels: item.attributes.dietaryLabels,
        })),
      })),
      integrationLabels: translation.integrationLabels,
    })),
    menuSections: draft.catalogSections.map((section) => ({
      name: section.name,
      description: section.description,
      items: section.items.map((item) => ({
        name: item.name,
        description: item.description,
        price: item.price,
        currency: item.currency,
        available: item.available,
        dietaryLabels: item.attributes.dietaryLabels,
        imageUrl: item.imageUrl,
        originalImageUrl: item.originalImageUrl,
        imageProvenance: item.imageProvenance,
      })),
    })),
    integrations: draft.integrations,
  });
}

export function fromRestaurantDraft(
  draft: RestaurantDraft,
): RestaurantSiteDraft {
  return restaurantSiteDraftSchema.parse({
    slug: draft.slug,
    name: draft.name,
    eyebrow: draft.eyebrow,
    description: draft.description,
    attributes: {
      cuisine: draft.cuisine,
      showMenuImages: draft.showMenuImages,
      designProfile: draft.designProfile,
      themeSelection: draft.themeSelection,
    },
    address: draft.address,
    phone: draft.phone,
    email: draft.email,
    sourceUrl: draft.sourceUrl,
    logoUrl: draft.logoUrl,
    faviconUrl: draft.faviconUrl,
    heroImageUrl: draft.heroImageUrl,
    heroOriginalImageUrl: draft.heroOriginalImageUrl,
    heroImageProvenance: draft.heroImageProvenance,
    galleryImages: draft.galleryImages,
    palette: draft.palette,
    sourceData: draft.sourceData,
    autoEnhanceImages: draft.autoEnhanceImages,
    defaultLocale: draft.defaultLocale,
    businessHours: draft.businessHours,
    translations: draft.translations.map((translation) => ({
      locale: translation.locale,
      status: translation.status,
      attributes: {
        cuisine: translation.cuisine,
      },
      eyebrow: translation.eyebrow,
      description: translation.description,
      catalogSections: translation.menuSections.map((section) => ({
        name: section.name,
        description: section.description,
        items: section.items.map((item) => ({
          name: item.name,
          description: item.description,
          attributes: {
            dietaryLabels: item.dietaryLabels,
          },
        })),
      })),
      integrationLabels: translation.integrationLabels,
    })),
    catalogSections: draft.menuSections.map((section) => ({
      name: section.name,
      description: section.description,
      items: section.items.map((item) => ({
        name: item.name,
        description: item.description,
        price: item.price,
        currency: item.currency,
        available: item.available,
        attributes: {
          dietaryLabels: item.dietaryLabels,
        },
        imageUrl: item.imageUrl,
        originalImageUrl: item.originalImageUrl,
        imageProvenance: item.imageProvenance,
      })),
    })),
    integrations: draft.integrations,
  });
}

// Price formatting is pure Intl and belongs to no vertical; it lives in the
// shared draft module so the renderer can reach it without importing a vertical.
export { formatPrice, slugify } from "@/lib/site-draft";

export function getRestaurantLocales(draft: RestaurantDraft): string[] {
  return [
    draft.defaultLocale,
    ...draft.translations.map((translation) => translation.locale),
  ];
}

export function localizeRestaurantDraft(
  draft: RestaurantDraft,
  locale: string,
): RestaurantDraft {
  if (locale === draft.defaultLocale) return draft;
  const translation = draft.translations.find(
    (candidate) => candidate.locale === locale,
  );
  if (!translation) return draft;

  return {
    ...draft,
    cuisine: translation.cuisine,
    eyebrow: translation.eyebrow,
    description: translation.description,
    menuSections: draft.menuSections.map((section, sectionIndex) => ({
      ...section,
      name: translation.menuSections[sectionIndex].name,
      description: translation.menuSections[sectionIndex].description,
      items: section.items.map((item, itemIndex) => ({
        ...item,
        name: translation.menuSections[sectionIndex].items[itemIndex].name,
        description:
          translation.menuSections[sectionIndex].items[itemIndex].description,
        dietaryLabels:
          translation.menuSections[sectionIndex].items[itemIndex].dietaryLabels,
      })),
    })),
    integrations: draft.integrations.map((integration, integrationIndex) => ({
      ...integration,
      label: translation.integrationLabels[integrationIndex],
    })),
  };
}
