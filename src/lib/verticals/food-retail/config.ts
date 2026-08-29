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
import { foodRetailOwnerOperations } from "@/lib/owner-operations";
import { siteUiLocale, type SiteUiLocale } from "@/lib/site-locales";
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
  mt: {
    language: "Lingwa",
    reservationsVia: "Ordna permezz ta’",
    bookingPartner: "is-sieħeb tal-ordnijiet tal-ħanut",
    seasonalNotice:
      "Id-dettalji tal-prodotti jistgħu jinbidlu. Ikkuntattja l-ħanut qabel ma tivvjaġġa.",
    heroImageAlt: "Il-ħanut u l-prodotti ta’",
    bookingHeading: "Ordnijiet",
    bookingRequestHeading: "",
    bookingRequestIntro: "",
    pickupHeading: "Ġbir",
  },
} satisfies Record<SiteUiLocale, Record<string, string>>;

const shopTypeLabels: Record<FoodShopType, Record<SiteUiLocale, string>> = {
  bakery: { en: "Bakery", fr: "Boulangerie", mt: "Furnara" },
  patisserie: { en: "Patisserie", fr: "Pâtisserie", mt: "Pastizzerija" },
  butcher: { en: "Butcher", fr: "Boucherie", mt: "Ħanut tal-laħam" },
  deli: { en: "Deli", fr: "Traiteur", mt: "Delikatessen" },
  cheesemonger: { en: "Cheesemonger", fr: "Fromagerie", mt: "Ħanut tal-ġobon" },
  grocer: { en: "Grocer", fr: "Épicerie", mt: "Ħanut tal-merċa" },
  "local-food-shop": {
    en: "Local food shop",
    fr: "Commerce alimentaire",
    mt: "Ħanut tal-ikel lokali",
  },
};

/**
 * The product badges the renderer stamps on a catalog row. A table rather than a
 * `fr ? … : …` ternary chain: a ternary answers "not French" with English, so a
 * new locale would ship silently half-translated instead of failing to compile.
 */
const itemBadgeLabels = {
  en: {
    inStock: "In stock",
    outOfStock: "Out of stock",
    preorder: "Preorder",
    allergens: "Allergens",
  },
  fr: {
    inStock: "En stock",
    outOfStock: "Rupture de stock",
    preorder: "Précommande",
    allergens: "Allergènes",
  },
  mt: {
    inStock: "Fl-istokk",
    outOfStock: "Mhux fl-istokk",
    preorder: "Ordni bil-quddiem",
    allergens: "Allerġeni",
  },
} satisfies Record<SiteUiLocale, Record<string, string>>;

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

export const foodRetailConfig = {
  id: Vertical.FOOD_RETAIL,
  vocabulary: {
    catalog: "Product ranges",
    section: "Category",
    item: "Product",
  },
  marketing: foodRetailMarketing,
  claimMode: "factory",
  supportsOwnerReview: true,
  publicationEnabled: true,
  publicationMutationEnabled: true,
  ownerOperations: foodRetailOwnerOperations,
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
    mt: {
      eyebrow: "Previżjoni privata tal-ħanut tal-ikel",
      description:
        "Previżjoni privata tal-ħanut tal-ikel mibnija biss mill-informazzjoni tas-sors disponibbli bħalissa.",
      catalogName: "Firxiet ta’ prodotti",
      emptyCatalogDescription:
        "Ebda dettall ta’ firxa ta’ prodotti ma nstab fid-data strutturata tas-sors.",
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
      const labels = itemBadgeLabels[siteUiLocale(locale)];
      const badges: string[] = [];
      if (attributes.stockSourceUrl && available === true) {
        badges.push(labels.inStock);
      }
      if (attributes.stockSourceUrl && available === false) {
        badges.push(labels.outOfStock);
      }
      if (attributes.seasonalAvailability) {
        badges.push(attributes.seasonalAvailability);
      }
      if (attributes.preorderRequired === true) {
        badges.push(labels.preorder);
      }
      if (attributes.preorderNote) badges.push(attributes.preorderNote);
      if (attributes.allergens.length > 0 && attributes.allergenSourceUrl) {
        badges.push(
          `${labels.allergens}: ${attributes.allergens.join(", ")}`,
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
