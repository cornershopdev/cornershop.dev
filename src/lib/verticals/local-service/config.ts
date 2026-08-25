import { Vertical } from "@/generated/prisma/enums";
import { localServiceMarketing } from "@/lib/verticals/local-service/marketing";
import { localServicePrompt } from "@/lib/verticals/local-service/prompt";
import {
  localServiceLinkKeywordHints,
  localServiceProviders,
  localServiceRelevantPathPattern,
} from "@/lib/verticals/local-service/providers";
import {
  localServiceAttributesSchema,
  localServiceItemAttributesSchema,
  localServiceSiteDraftSchema,
  type LocalServiceAttributes,
  type LocalServiceItemAttributes,
  type LocalServiceSiteDraft,
  type LocalServiceTradeType,
} from "@/lib/verticals/local-service/schema";
import {
  localServiceTemplates,
  resolveLocalServiceTemplateFromAttributes,
  type LocalServiceTemplate,
} from "@/lib/verticals/local-service/templates";
import { localServiceOwnerOperations } from "@/lib/owner-operations";
import type { VerticalConfig } from "@/lib/verticals/types";

const tradeLabels: Record<LocalServiceTradeType, string> = {
  plumber: "Plumber",
  electrician: "Electrician",
  builder: "Builder",
  repair: "Repair specialist",
  artisan: "Artisan",
  "general-trades": "Local trade",
};

const availabilityLabels: Record<
  "en" | "fr",
  Record<LocalServiceAttributes["availabilityPosture"], string | null>
> = {
  en: {
    "not-stated": null,
    scheduled: "Scheduled work",
    "same-day": "Same-day availability stated",
    "emergency-callout": "Emergency callouts stated",
    "24-7-emergency": "24/7 emergency service stated",
    "by-appointment": "By appointment",
  },
  fr: {
    "not-stated": null,
    scheduled: "Interventions planifiées",
    "same-day": "Disponibilité le jour même indiquée",
    "emergency-callout": "Dépannages d’urgence indiqués",
    "24-7-emergency": "Service d’urgence 24 h/24 indiqué",
    "by-appointment": "Sur rendez-vous",
  },
};

function localServiceLanguage(locale: string): "en" | "fr" {
  return locale.toLowerCase().split("-")[0] === "fr" ? "fr" : "en";
}

/**
 * LOCAL_SERVICE treats model output as an untrusted presentation proposal.
 * Every operational or reputational fact is replaced with the deterministic
 * reconstruction before persistence. The only retained model choice is whether
 * to show an already source-backed project gallery; it cannot create a project
 * or make a claim on its own.
 */
export function bindGeneratedLocalServiceDraftToEvidence({
  generated,
  deterministic,
}: {
  generated: LocalServiceSiteDraft;
  deterministic: LocalServiceSiteDraft;
}): LocalServiceSiteDraft {
  return {
    ...deterministic,
    attributes: {
      ...deterministic.attributes,
      showProjectGallery:
        deterministic.attributes.projects.length > 0 &&
        generated.attributes.showProjectGallery,
    },
    // There is no owner-review status on local-service translations yet. Until
    // that contract exists, generated overlays are discarded rather than
    // persisting model-authored service or trust wording as reviewed copy.
    translations: deterministic.translations,
  };
}

export const localServiceDictionaryExtensions = {
  en: {
    language: "Language",
    reservationsVia: "Contact via",
    bookingPartner: "our scheduling partner",
    seasonalNotice:
      "Service coverage and availability may change. Confirm before booking work.",
    heroImageAlt: "Image for",
    bookingHeading: "Contact",
    bookingRequestHeading: "Request the work",
    bookingRequestIntro:
      "Use the listed phone, WhatsApp or quote tool to describe the job.",
    serviceAreasHeading: "Service areas",
    credentialsHeading: "Credentials and cover",
    trustHeading: "Why customers call",
    projectsHeading: "Projects",
  },
  fr: {
    language: "Langue",
    reservationsVia: "Contacter via",
    bookingPartner: "notre outil de contact",
    seasonalNotice:
      "Les zones desservies et les disponibilités peuvent évoluer. Confirmez avant les travaux.",
    heroImageAlt: "Image de",
    bookingHeading: "Contact",
    bookingRequestHeading: "Demander une intervention",
    bookingRequestIntro:
      "Utilisez le téléphone, WhatsApp ou l’outil de devis indiqué pour décrire les travaux.",
    serviceAreasHeading: "Zones desservies",
    credentialsHeading: "Qualifications et assurance",
    trustHeading: "Éléments de confiance",
    projectsHeading: "Projets",
  },
} satisfies Record<string, Record<string, string>>;

const attributeDefaults: LocalServiceAttributes = {
  tradeType: "general-trades",
  availabilityPosture: "not-stated",
  serviceAreas: [],
  credentials: [],
  insuranceStatus: "not-stated",
  insuranceDetail: "",
  trustSignals: [],
  projects: [],
  showProjectGallery: true,
};

function tradeTypeFromSource(
  businessTypes: string[] = [],
): LocalServiceTradeType {
  const types = new Set(businessTypes.map((type) => type.toLowerCase()));
  if (types.has("plumber")) return "plumber";
  if (types.has("electrician")) return "electrician";
  if (types.has("generalcontractor") || types.has("roofingcontractor")) {
    return "builder";
  }
  if (types.has("hvacbusiness") || types.has("locksmith")) return "repair";
  if (types.has("housepainter")) return "artisan";
  return "general-trades";
}

export const localServiceConfig = {
  id: Vertical.LOCAL_SERVICE,
  vocabulary: {
    catalog: "Services",
    section: "Service group",
    item: "Service",
  },
  marketing: localServiceMarketing,
  claimMode: "factory",
  publicationEnabled: true,
  publicationMutationEnabled: true,
  ownerOperations: localServiceOwnerOperations,
  draftGenerationStrategy: "deterministic-only",
  integrationTypes: ["quote", "contact", "booking", "social"],
  attributesSchema: localServiceAttributesSchema,
  attributeDefaults,
  deterministicAttributes: attributeDefaults,
  deterministicAttributesFromSource: (source) => ({
    ...attributeDefaults,
    tradeType: tradeTypeFromSource(source.businessTypes),
    showProjectGallery: false,
  }),
  deterministicCopy: {
    en: {
      eyebrow: "Private local-service preview",
      description:
        "A private local-service preview built only from source information currently available.",
      catalogName: "Services",
      emptyCatalogDescription:
        "No service details were present in deterministic source markup.",
    },
    fr: {
      eyebrow: "Aperçu privé de l’entreprise",
      description:
        "Un aperçu privé fondé uniquement sur les informations source disponibles.",
      catalogName: "Services",
      emptyCatalogDescription:
        "Aucun service n’était présent dans les données source structurées.",
    },
  },
  itemAttributesSchema: localServiceItemAttributesSchema,
  itemAttributeDefaults: {
    pricingModel: "not-stated",
    priceUnit: "",
    emergencyEligible: false,
  },
  draftSchema: localServiceSiteDraftSchema,
  prompt: localServicePrompt,
  imageEnhancement: {
    subject: "local-service project photograph",
    contextLabel: "Trade business",
    forbiddenElements:
      "completed work, wiring, pipework, joinery, finish, defect, damage, safety equipment, credential, certification mark",
    sceneClause:
      "make unfinished work look complete or make the job look like a different trade",
    fidelityClause:
      "the condition, quality, safety or outcome of the work actually shown",
    gradeClause:
      "Use a neutral documentary colour grade. Avoid fake before-and-after contrast, removed defects, fabricated finishes, exaggerated sharpness, artificial dust or sparks, and stock-photo polish.",
  },
  presentation: {
    fallbackDescription:
      "An independent local trade providing clearly described services and a direct way to request the work.",
    fallbackPalette: {
      background: "#f3f1ec",
      foreground: "#18201d",
      accent: "#c6532d",
    },
    buildEyebrow: (attributes, site) =>
      `${tradeLabels[attributes.tradeType]} · ${site.address ?? "Local"}`,
    itemBadges: (attributes, locale) => {
      const language = localServiceLanguage(locale);
      const badges: string[] = [];
      if (attributes.pricingModel === "quote") {
        badges.push(language === "fr" ? "Devis requis" : "Quote required");
      }
      if (attributes.pricingModel === "from") {
        badges.push(language === "fr" ? "À partir de" : "From");
      }
      if (attributes.pricingModel === "hourly") {
        badges.push(
          attributes.priceUnit ||
            (language === "fr" ? "Tarif horaire" : "Hourly"),
        );
      } else if (attributes.priceUnit) badges.push(attributes.priceUnit);
      if (attributes.emergencyEligible) {
        badges.push(
          language === "fr" ? "Intervention d’urgence" : "Emergency callout",
        );
      }
      return badges;
    },
    businessDetails: (attributes, locale) => {
      const language = localServiceLanguage(locale);
      return {
        availability:
          availabilityLabels[language][attributes.availabilityPosture],
        serviceAreas: attributes.serviceAreas,
        credentials: attributes.credentials.map((credential) =>
          [credential.name, credential.issuer, credential.reference]
            .filter(Boolean)
            .join(" · "),
        ),
        trustSignals: [
          ...(attributes.insuranceStatus === "insured"
            ? [
                attributes.insuranceDetail ||
                  (language === "fr"
                    ? "Assurance indiquée par l’entreprise"
                    : "Insurance stated by the business"),
              ]
            : attributes.insuranceStatus === "not-insured"
              ? [
                  language === "fr"
                    ? "L’entreprise indique ne pas être assurée"
                    : "Business states that it is not insured",
                ]
              : []),
          ...attributes.trustSignals.map((signal) =>
            [signal.label, signal.detail].filter(Boolean).join(" · "),
          ),
        ],
        projects: attributes.projects.map((project) => ({
          title: project.title,
          description: project.description,
          imageUrl: project.imageUrl,
          location: project.location,
        })),
      };
    },
  },
  templates: {
    definitions: localServiceTemplates,
    resolve: resolveLocalServiceTemplateFromAttributes,
  },
  normalizeGeneratedAttributes: (attributes, template) => ({
    ...attributes,
    showProjectGallery:
      attributes.projects.length > 0 &&
      (attributes.showProjectGallery || template.showProjectImagesByDefault),
  }),
  bindGeneratedDraftToEvidence: bindGeneratedLocalServiceDraftToEvidence,
  deterministicItemAttributes: (item) => ({
    pricingModel:
      item.price === null || item.currency === null ? "not-stated" : "fixed",
    priceUnit: "",
    emergencyEligible: false,
  }),
  providers: localServiceProviders,
  crawl: {
    relevantPathPattern: localServiceRelevantPathPattern,
    linkKeywordHints: localServiceLinkKeywordHints,
  },
  i18n: localServiceDictionaryExtensions,
  rendererCapabilities: (attributes) => ({
    showGallery: attributes.showProjectGallery,
    primaryAction: "quote",
    bookingRequestMode: "never",
  }),
} satisfies VerticalConfig<
  LocalServiceAttributes,
  LocalServiceItemAttributes,
  LocalServiceTemplate,
  LocalServiceSiteDraft
>;
