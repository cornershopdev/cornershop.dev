import { Vertical } from "@/generated/prisma/enums";
import {
  foodRetailAttributesSchema,
  foodRetailItemAttributesSchema,
  foodRetailSiteDraftSchema,
  type FoodRetailAttributes,
  type FoodRetailItemAttributes,
  type FoodRetailSiteDraft,
  type FoodShopType,
} from "@/lib/verticals/food-retail/schema";
import {
  foodRetailLinkKeywordHints,
  foodRetailProviders,
  foodRetailRelevantPathPattern,
} from "@/lib/verticals/food-retail/providers";
import { foodRetailMarketing } from "@/lib/verticals/food-retail/marketing";
import { foodRetailPrompt } from "@/lib/verticals/food-retail/prompt";
import {
  foodRetailTemplates,
  resolveFoodRetailTemplateFromAttributes,
  type FoodRetailTemplate,
} from "@/lib/verticals/food-retail/templates";
import type { VerticalConfig } from "@/lib/verticals/types";

export const foodRetailDictionaryExtensions = {
  en: {
    language: "Language",
    reservationsVia: "Order via",
    bookingPartner: "the shop’s ordering partner",
    seasonalNotice:
      "Product details can change. Contact the shop before travelling.",
    heroImageAlt: "Shop and products at",
    bookingHeading: "Ordering",
    bookingRequestHeading: "",
    bookingRequestIntro: "",
    pickupHeading: "Pickup",
  },
  fr: {
    language: "Langue",
    reservationsVia: "Commander via",
    bookingPartner: "le partenaire de commande de la boutique",
    seasonalNotice:
      "Les informations produit peuvent évoluer. Contactez la boutique avant de vous déplacer.",
    heroImageAlt: "Boutique et produits chez",
    bookingHeading: "Commande",
    bookingRequestHeading: "",
    bookingRequestIntro: "",
    pickupHeading: "Retrait",
  },
} satisfies Record<string, Record<string, string>>;

const shopTypeLabels: Record<FoodShopType, Record<"en" | "fr", string>> = {
  bakery: { en: "Bakery", fr: "Boulangerie" },
  patisserie: { en: "Patisserie", fr: "Pâtisserie" },
  butcher: { en: "Butcher", fr: "Boucherie" },
  deli: { en: "Deli", fr: "Traiteur" },
  cheesemonger: { en: "Cheesemonger", fr: "Fromagerie" },
  grocer: { en: "Grocer", fr: "Épicerie" },
  "local-food-shop": { en: "Local food shop", fr: "Commerce alimentaire" },
};

/**
 * FOOD_RETAIL treats the model as a presentation assistant, never an evidence
 * source. Canonical business facts and catalog rows come only from deterministic
 * reconstruction; translated overlays are retained as drafts but mirror the
 * evidence-bound structure and claim fields until an owner reviews them.
 */
export function bindGeneratedFoodRetailDraftToEvidence({
  generated,
  deterministic,
}: {
  generated: FoodRetailSiteDraft;
  deterministic: FoodRetailSiteDraft;
}): FoodRetailSiteDraft {
  return {
    ...generated,
    slug: deterministic.slug,
    name: deterministic.name,
    eyebrow: deterministic.eyebrow,
    description: deterministic.description,
    address: deterministic.address,
    phone: deterministic.phone,
    email: deterministic.email,
    sourceUrl: deterministic.sourceUrl,
    logoUrl: deterministic.logoUrl,
    faviconUrl: deterministic.faviconUrl,
    heroImageUrl: deterministic.heroImageUrl,
    heroOriginalImageUrl: deterministic.heroOriginalImageUrl,
    heroImageProvenance: deterministic.heroImageProvenance,
    sourceData: deterministic.sourceData,
    defaultLocale: deterministic.defaultLocale,
    attributes: {
      ...deterministic.attributes,
      showProductImages: generated.attributes.showProductImages,
    },
    businessHours: deterministic.businessHours,
    catalogSections: deterministic.catalogSections,
    integrations: deterministic.integrations,
    translations: generated.translations.map((translation) => ({
      ...translation,
      status: "draft",
      attributes: {
        pickupDetails: deterministic.attributes.pickupDetails,
      },
      catalogSections: deterministic.catalogSections.map((section) => ({
        name: section.name,
        description: section.description,
        items: section.items.map((item) => ({
          name: item.name,
          description: item.description,
          attributes: {
            seasonalAvailability: item.attributes.seasonalAvailability,
            preorderNote: item.attributes.preorderNote,
            allergens: [...item.attributes.allergens],
          },
        })),
      })),
      integrationLabels: deterministic.integrations.map(
        (integration) => integration.label,
      ),
    })),
  };
}

function language(locale: string): "en" | "fr" {
  return locale.toLowerCase().startsWith("fr") ? "fr" : "en";
}

export const foodRetailConfig = {
  id: Vertical.FOOD_RETAIL,
  vocabulary: {
    catalog: "Product ranges",
    section: "Category",
    item: "Product",
  },
  marketing: foodRetailMarketing,
  claimMode: "factory",
  publicationEnabled: true,
  publicationMutationEnabled: true,
  integrationTypes: ["ordering", "delivery", "social"],
  attributesSchema: foodRetailAttributesSchema,
  attributeDefaults: {
    shopType: "local-food-shop",
    showProductImages: true,
    pickupDetails: "",
  },
  deterministicAttributes: {
    shopType: "local-food-shop",
    showProductImages: false,
    pickupDetails: "",
  },
  deterministicCopy: {
    en: {
      eyebrow: "Private food retail preview",
      description:
        "A private food retail preview built only from source information currently available.",
      catalogName: "Product ranges",
      emptyCatalogDescription:
        "No product range details were present in deterministic source markup.",
    },
    fr: {
      eyebrow: "Aperçu privé du commerce alimentaire",
      description:
        "Un aperçu privé du commerce alimentaire fondé uniquement sur les informations source disponibles.",
      catalogName: "Gammes de produits",
      emptyCatalogDescription:
        "Aucune gamme de produits n’était présente dans les données source structurées.",
    },
  },
  itemAttributesSchema: foodRetailItemAttributesSchema,
  itemAttributeDefaults: {
    visible: true,
    stockSourceUrl: null,
    seasonalAvailability: "",
    preorderRequired: null,
    preorderNote: "",
    allergens: [],
    allergenSourceUrl: null,
  },
  draftSchema: foodRetailSiteDraftSchema,
  prompt: foodRetailPrompt,
  imageEnhancement: {
    subject: "local food retail photograph",
    contextLabel: "Food shop",
    forbiddenElements:
      "product, ingredient, cut, loaf, pastry, filling, finish, portion, package, label, price sign",
    sceneClause: "make the counter or shop look like a different business",
    fidelityClause: "what the shop actually makes, stocks or looks like",
    gradeClause:
      "Use a natural retail colour grade. Avoid fake steam, artificial gloss, exaggerated saturation, reshaped products, replaced packaging, fake depth of field, and stock-photo polish.",
  },
  presentation: {
    fallbackDescription:
      "An independent local food shop with product ranges, opening hours and pickup details presented clearly.",
    fallbackPalette: {
      background: "#f5efe3",
      foreground: "#2a2118",
      accent: "#a34f2d",
    },
    buildEyebrow: (attributes, site) =>
      `${shopTypeLabels[attributes.shopType].en} · ${site.address ?? "Local"}`,
    itemBadges: (attributes, locale, available) => {
      const localeLanguage = language(locale);
      const badges: string[] = [];
      if (attributes.stockSourceUrl && available === true) {
        badges.push(localeLanguage === "fr" ? "En stock" : "In stock");
      }
      if (attributes.stockSourceUrl && available === false) {
        badges.push(
          localeLanguage === "fr" ? "Rupture de stock" : "Out of stock",
        );
      }
      if (attributes.seasonalAvailability) {
        badges.push(attributes.seasonalAvailability);
      }
      if (attributes.preorderRequired === true) {
        badges.push(localeLanguage === "fr" ? "Précommande" : "Preorder");
      }
      if (attributes.preorderNote) badges.push(attributes.preorderNote);
      if (attributes.allergens.length > 0 && attributes.allergenSourceUrl) {
        badges.push(
          `${localeLanguage === "fr" ? "Allergènes" : "Allergens"}: ${attributes.allergens.join(", ")}`,
        );
      }
      return badges;
    },
    isItemVisible: (item) => item.attributes.visible,
    fulfillmentNote: (attributes) => attributes.pickupDetails || null,
  },
  templates: {
    definitions: foodRetailTemplates,
    resolve: resolveFoodRetailTemplateFromAttributes,
  },
  normalizeGeneratedAttributes: (attributes, template) => ({
    ...attributes,
    showProductImages: template.showProductImagesByDefault,
  }),
  normalizeGeneratedItem: (item) => ({
    ...item,
    available: null,
    attributes: {
      ...item.attributes,
      visible: true,
      stockSourceUrl: null,
    },
  }),
  bindGeneratedDraftToEvidence: bindGeneratedFoodRetailDraftToEvidence,
  deterministicItemAttributes: (item) => ({
    visible: true,
    stockSourceUrl: item.availabilitySourceUrl ?? null,
    seasonalAvailability: "",
    preorderRequired: null,
    preorderNote: "",
    allergens: [],
    allergenSourceUrl: null,
  }),
  generatedTranslationStatus: "draft",
  providers: foodRetailProviders,
  crawl: {
    relevantPathPattern: foodRetailRelevantPathPattern,
    linkKeywordHints: foodRetailLinkKeywordHints,
  },
  i18n: foodRetailDictionaryExtensions,
  rendererCapabilities: (attributes) => ({
    showGallery: attributes.showProductImages,
    primaryAction: "ordering",
    bookingRequestMode: "never",
  }),
} satisfies VerticalConfig<
  FoodRetailAttributes,
  FoodRetailItemAttributes,
  FoodRetailTemplate,
  FoodRetailSiteDraft
>;
