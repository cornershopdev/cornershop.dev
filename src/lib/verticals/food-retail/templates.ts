import type {
  FoodRetailAttributes,
  FoodShopType,
} from "@/lib/verticals/food-retail/schema";
import type { SiteUiLocale } from "@/lib/site-locales";
import type { VerticalTemplateCopy } from "@/lib/verticals/types";

export type FoodRetailTemplateId =
  | "daily-counter"
  | "craft-counter"
  | "market-shelves";

export type FoodRetailTemplate = {
  id: FoodRetailTemplateId;
  heroLayout: "split" | "immersive" | "card";
  catalogLayout: "stack" | "columns" | "cards";
  brandClassName: string;
  titleClassName: string;
  sectionClassName: string;
  showProductImagesByDefault: boolean;
  copy: Record<SiteUiLocale, VerticalTemplateCopy>;
};

export const foodRetailTemplates: Record<
  FoodRetailTemplateId,
  FoodRetailTemplate
> = {
  "daily-counter": {
    id: "daily-counter",
    heroLayout: "immersive",
    catalogLayout: "cards",
    brandClassName: "font-bold tracking-[-0.035em]",
    titleClassName: "font-bold leading-[0.9] tracking-[-0.055em] text-balance",
    sectionClassName:
      "rounded-[1.35rem] border border-current/10 bg-white/45 p-6",
    showProductImagesByDefault: true,
    copy: {
      en: {
        catalogEyebrow: "Product range",
        catalogHeading: "Explore the published range.",
        featuredHeading: "Selected products",
        featuredSubheading: "Browse products listed by the shop.",
      },
      fr: {
        catalogEyebrow: "Gamme de produits",
        catalogHeading: "Découvrez la gamme publiée.",
        featuredHeading: "Produits sélectionnés",
        featuredSubheading: "Parcourez les produits présentés par la boutique.",
      },
      mt: {
        catalogEyebrow: "Il-firxa tal-prodotti",
        catalogHeading: "Esplora l-firxa ppubblikata.",
        featuredHeading: "Prodotti magħżula",
        featuredSubheading: "Ara l-prodotti elenkati mill-ħanut.",
      },
    },
  },
  "craft-counter": {
    id: "craft-counter",
    heroLayout: "split",
    catalogLayout: "columns",
    brandClassName: "font-semibold uppercase tracking-[0.11em]",
    titleClassName:
      "font-semibold leading-[0.92] tracking-[-0.05em] text-balance",
    sectionClassName: "border-t-2 border-current/20 pt-6",
    showProductImagesByDefault: true,
    copy: {
      en: {
        catalogEyebrow: "The range",
        catalogHeading: "Products from the published range.",
        featuredHeading: "Selected products",
        featuredSubheading: "Details supplied by the shop.",
      },
      fr: {
        catalogEyebrow: "La gamme",
        catalogHeading: "Produits de la gamme publiée.",
        featuredHeading: "Produits sélectionnés",
        featuredSubheading: "Informations fournies par la boutique.",
      },
      mt: {
        catalogEyebrow: "Il-firxa",
        catalogHeading: "Prodotti mill-firxa ppubblikata.",
        featuredHeading: "Prodotti magħżula",
        featuredSubheading: "Dettalji pprovduti mill-ħanut.",
      },
    },
  },
  "market-shelves": {
    id: "market-shelves",
    heroLayout: "card",
    catalogLayout: "stack",
    brandClassName: "font-medium tracking-[-0.02em]",
    titleClassName:
      "font-medium leading-[0.94] tracking-[-0.05em] text-balance",
    sectionClassName: "border-t border-current/15 pt-6",
    showProductImagesByDefault: false,
    copy: {
      en: {
        catalogEyebrow: "Product ranges",
        catalogHeading: "What the shop publishes.",
        featuredHeading: "Selected products",
        featuredSubheading: "A closer look at the published range.",
      },
      fr: {
        catalogEyebrow: "Gammes de produits",
        catalogHeading: "Ce que publie la boutique.",
        featuredHeading: "Produits sélectionnés",
        featuredSubheading: "Un aperçu de la gamme publiée.",
      },
      mt: {
        catalogEyebrow: "Firxiet ta’ prodotti",
        catalogHeading: "Dak li jippubblika l-ħanut.",
        featuredHeading: "Prodotti magħżula",
        featuredSubheading: "Ħarsa aktar mill-qrib lejn il-firxa ppubblikata.",
      },
    },
  },
};

const templateForShopType: Record<FoodShopType, FoodRetailTemplateId> = {
  bakery: "daily-counter",
  patisserie: "daily-counter",
  butcher: "craft-counter",
  deli: "craft-counter",
  cheesemonger: "craft-counter",
  grocer: "market-shelves",
  "local-food-shop": "market-shelves",
};

export function resolveFoodRetailTemplateFromAttributes(
  attributes: FoodRetailAttributes,
): FoodRetailTemplate {
  return foodRetailTemplates[templateForShopType[attributes.shopType]];
}
