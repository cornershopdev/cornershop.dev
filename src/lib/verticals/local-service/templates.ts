import type {
  LocalServiceAttributes,
  LocalServiceTradeType,
} from "@/lib/verticals/local-service/schema";
import type { SiteUiLocale } from "@/lib/site-locales";
import type { VerticalTemplateCopy } from "@/lib/verticals/types";

export type LocalServiceTemplate = {
  id: LocalServiceTradeType;
  heroLayout: "split" | "immersive" | "card";
  catalogLayout: "stack" | "columns" | "cards";
  brandClassName: string;
  titleClassName: string;
  sectionClassName: string;
  showProjectImagesByDefault: boolean;
  copy: Record<SiteUiLocale, VerticalTemplateCopy>;
};

const sharedTitle =
  "font-extrabold leading-[0.9] tracking-[-0.055em] text-balance";

export const localServiceTemplates: Record<
  LocalServiceTradeType,
  LocalServiceTemplate
> = {
  plumber: template("plumber", "split", "stack", false, {
    catalogEyebrow: "Plumber",
    catalogHeading: "Services listed by the business.",
    featuredHeading: "Projects",
    featuredSubheading: "Project information provided by the business.",
  }),
  electrician: template("electrician", "split", "columns", false, {
    catalogEyebrow: "Electrician",
    catalogHeading: "Services listed by the business.",
    featuredHeading: "Projects",
    featuredSubheading: "Project information provided by the business.",
  }),
  builder: template("builder", "immersive", "cards", true, {
    catalogEyebrow: "Builder",
    catalogHeading: "Services listed by the business.",
    featuredHeading: "Projects",
    featuredSubheading: "Project information provided by the business.",
  }),
  repair: template("repair", "card", "stack", false, {
    catalogEyebrow: "Repair trade",
    catalogHeading: "Services listed by the business.",
    featuredHeading: "Projects",
    featuredSubheading: "Project information provided by the business.",
  }),
  artisan: template("artisan", "immersive", "cards", true, {
    catalogEyebrow: "Artisan",
    catalogHeading: "Services listed by the business.",
    featuredHeading: "Projects",
    featuredSubheading: "Project information provided by the business.",
  }),
  "general-trades": template("general-trades", "split", "columns", true, {
    catalogEyebrow: "Local trade",
    catalogHeading: "Services listed by the business.",
    featuredHeading: "Projects",
    featuredSubheading: "Project information provided by the business.",
  }),
};

function template(
  id: LocalServiceTradeType,
  heroLayout: LocalServiceTemplate["heroLayout"],
  catalogLayout: LocalServiceTemplate["catalogLayout"],
  showProjectImagesByDefault: boolean,
  copy: VerticalTemplateCopy,
): LocalServiceTemplate {
  return {
    id,
    heroLayout,
    catalogLayout,
    brandClassName: "font-bold tracking-[-0.035em]",
    titleClassName: sharedTitle,
    sectionClassName: "border-t-2 border-current/15 pt-6",
    showProjectImagesByDefault,
    copy: {
      en: copy,
      fr: {
        catalogEyebrow: tradeLabelFr(id),
        catalogHeading: "Services indiqués par l’entreprise.",
        featuredHeading: "Projets",
        featuredSubheading: "Informations de projet fournies par l’entreprise.",
      },
      mt: {
        catalogEyebrow: tradeLabelMt(id),
        catalogHeading: "Servizzi elenkati min-negozju.",
        featuredHeading: "Proġetti",
        featuredSubheading:
          "Informazzjoni dwar il-proġetti pprovduta min-negozju.",
      },
    },
  };
}

function tradeLabelFr(id: LocalServiceTradeType): string {
  return {
    plumber: "Plombier",
    electrician: "Électricien",
    builder: "Entreprise du bâtiment",
    repair: "Dépannage",
    artisan: "Artisan",
    "general-trades": "Entreprise locale",
  }[id];
}

function tradeLabelMt(id: LocalServiceTradeType): string {
  return {
    plumber: "Plamer",
    electrician: "Elettriċista",
    builder: "Bennej",
    repair: "Tiswijiet",
    artisan: "Artiġjan",
    "general-trades": "Negozju lokali",
  }[id];
}

export function resolveLocalServiceTemplateFromAttributes(
  attributes: LocalServiceAttributes,
): LocalServiceTemplate {
  return localServiceTemplates[attributes.tradeType];
}
