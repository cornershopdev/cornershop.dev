import { Vertical } from "@/generated/prisma/enums";
import {
  beautyAttributesSchema,
  beautyItemAttributesSchema,
  beautySiteDraftSchema,
  type BeautyAttributes,
  type BeautyItemAttributes,
  type BeautySiteDraft,
  type ServiceStyle,
} from "@/lib/verticals/beauty/schema";
import {
  beautyLinkKeywordHints,
  beautyProviders,
  beautyRelevantPathPattern,
} from "@/lib/verticals/beauty/providers";
import { beautyMarketing } from "@/lib/verticals/beauty/marketing";
import { beautyPrompt } from "@/lib/verticals/beauty/prompt";
import {
  beautyTemplates,
  resolveBeautyTemplateFromAttributes,
  type BeautyTemplate,
} from "@/lib/verticals/beauty/templates";
import { beautyOwnerOperations } from "@/lib/owner-operations";
import type { VerticalConfig } from "@/lib/verticals/types";

export const beautyDictionaryExtensions = {
  en: {
    language: "Language",
    reservationsVia: "Book via",
    bookingPartner: "our booking partner",
    seasonalNotice: "Services and availability may change.",
    heroImageAlt: "Interior of",
    bookingHeading: "Appointments",
    bookingRequestHeading: "Request an appointment",
    bookingRequestIntro:
      "Tell us what you'd like and when, and we'll confirm by email or phone.",
  },
  fr: {
    language: "Langue",
    reservationsVia: "Réserver via",
    bookingPartner: "notre partenaire de réservation",
    seasonalNotice: "Les prestations et disponibilités peuvent évoluer.",
    heroImageAlt: "Intérieur du salon",
    bookingHeading: "Rendez-vous",
    bookingRequestHeading: "Demander un rendez-vous",
    bookingRequestIntro:
      "Dites-nous ce que vous souhaitez et quand, nous confirmerons par e-mail ou par téléphone.",
  },
} satisfies Record<string, Record<string, string>>;

const serviceStyleLabels: Record<ServiceStyle, string> = {
  barbershop: "Barbershop",
  "classic-salon": "Hair salon",
  "modern-studio": "Beauty studio",
  "spa-luxe": "Spa",
  "express-nails": "Nail bar",
};

/**
 * Beauty has no sample fixture — the restaurant one exists to back the demo on
 * `/create`, which stays a restaurant. So the read-path fallbacks are literals
 * here instead of being sourced from a draft.
 */
const beautyFallbackDescription =
  "An independent studio taking appointments for cuts, colour and care.";

const beautyFallbackPalette = {
  background: "#f7f4f1",
  foreground: "#211d1b",
  accent: "#9a6f52",
};

export const beautyConfig = {
  id: Vertical.BEAUTY,
  vocabulary: {
    catalog: "Services",
    section: "Category",
    item: "Service",
  },
  marketing: beautyMarketing,
  claimMode: "disabled",
  publicationEnabled: true,
  publicationMutationEnabled: false,
  ownerOperations: beautyOwnerOperations,
  integrationTypes: ["booking", "social"],
  attributesSchema: beautyAttributesSchema,
  attributeDefaults: {
    serviceStyle: "modern-studio",
    showServiceImages: false,
  },
  itemAttributesSchema: beautyItemAttributesSchema,
  itemAttributeDefaults: {
    durationMinutes: null,
    anyStylist: false,
  },
  draftSchema: beautySiteDraftSchema,
  prompt: beautyPrompt,
  imageEnhancement: {
    subject: "salon photograph",
    contextLabel: "Salon",
    // Beauty's equivalent of the restaurant's "never restyle the food": a
    // retouched result photograph is a claim about what the customer will get.
    forbiddenElements:
      "skin, complexion, hair, nail, lash, brow, tattoo, body shape, treatment result",
    sceneClause: "make the space look like a different kind of business",
    fidelityClause: "what the business actually offers or looks like",
    gradeClause:
      "Use a natural colour grade. Avoid skin smoothing, teeth or eye whitening, reshaping, exaggerated saturation, fake depth of field, and stock-photo polish.",
  },
  presentation: {
    fallbackDescription: beautyFallbackDescription,
    fallbackPalette: beautyFallbackPalette,
    buildEyebrow: (attributes, site) =>
      `${serviceStyleLabels[attributes.serviceStyle]} · ${site.address ?? "Local"}`,
    /**
     * Duration is the badge a service list needs — it is what a customer checks
     * before price. The renderer passes the page locale, so the any-stylist
     * phrase localizes while the duration unit stays numeric.
     */
    itemBadges: (attributes, locale) => {
      const badges: string[] = [];
      if (attributes.durationMinutes !== null) {
        badges.push(`${attributes.durationMinutes} min`);
      }
      if (attributes.anyStylist) {
        badges.push(
          locale.toLowerCase().startsWith("fr")
            ? "Tout praticien"
            : "With any stylist",
        );
      }
      return badges;
    },
  },
  templates: {
    definitions: beautyTemplates,
    resolve: resolveBeautyTemplateFromAttributes,
  },
  normalizeGeneratedAttributes: (attributes, template) => ({
    ...attributes,
    showServiceImages: template.showServiceImagesByDefault,
  }),
  providers: beautyProviders,
  crawl: {
    relevantPathPattern: beautyRelevantPathPattern,
    linkKeywordHints: beautyLinkKeywordHints,
  },
  i18n: beautyDictionaryExtensions,
  /**
   * On, unlike the restaurant. No beauty provider ships an embeddable widget, so
   * without the request form a salon whose only booking link is Booksy would send
   * every customer off-site — the form is this vertical's only on-page capture.
   */
  rendererCapabilities: (attributes) => ({
    showGallery: attributes.showServiceImages,
    primaryAction: "booking",
    bookingRequestMode: "always",
  }),
} satisfies VerticalConfig<
  BeautyAttributes,
  BeautyItemAttributes,
  BeautyTemplate,
  BeautySiteDraft
>;
