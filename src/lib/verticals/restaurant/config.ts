import { Vertical } from "@/generated/prisma/enums";
import {
  restaurantAttributesSchema,
  restaurantItemAttributesSchema,
  restaurantSiteDraftSchema,
  sampleRestaurant,
  type RestaurantAttributes,
  type RestaurantItemAttributes,
  type RestaurantSiteDraft,
} from "@/lib/verticals/restaurant/schema";
import {
  restaurantLinkKeywordHints,
  restaurantProviders,
  restaurantRelevantPathPattern,
} from "@/lib/verticals/restaurant/providers";
import { restaurantMarketing } from "@/lib/verticals/restaurant/marketing";
import { restaurantPrompt } from "@/lib/verticals/restaurant/prompt";
import {
  DEFAULT_RESTAURANT_DESIGN_PROFILE,
  normalizeGeneratedRestaurantThemeSelection,
  selectDeterministicRestaurantTheme,
} from "@/lib/site-themes/restaurant/selection";
import {
  restaurantTemplates,
  resolveRestaurantTemplateFromAttributes,
  type RestaurantTemplate,
} from "@/lib/verticals/restaurant/templates";
import { restaurantOwnerOperations } from "@/lib/owner-operations";
import type { VerticalConfig } from "@/lib/verticals/types";

export const restaurantDictionaryExtensions = {
  en: {
    language: "Language",
    reservationsVia: "Reservations via",
    bookingPartner: "our booking partner",
    seasonalNotice: "Menu and availability may change with the season.",
    // Read by the shared renderer for the hero `alt`, so the key is generic even
    // though the restaurant phrasing behind it is not.
    heroImageAlt: "Dining room at",
    // The booking form itself is engine copy (see `sharedSiteDictionary`); only
    // the words around it are food-flavoured.
    bookingHeading: "Reservations",
    bookingRequestHeading: "Request a table",
    bookingRequestIntro:
      "Tell us when you'd like to come and we'll confirm by email or phone.",
    themePlanVisit: "Plan a visit",
    themeMenuEyebrow: "The menu",
    terroirMenuHeading: "Guided by the season.",
    terroirVisitEyebrow: "At the table",
    terroirVisitHeading: "Make time for the whole menu.",
    themeBrowseMenu: "Browse the menu",
    themeMenuCategories: "Menu categories",
    counterMenuEyebrow: "Ready when you are",
    counterMenuHeading: "Pick your order.",
    afterDarkEventsEyebrow: "What’s on",
    afterDarkMenuEyebrow: "Food & drink",
    afterDarkMenuHeading: "Stay after dark.",
    afterDarkMenuIntro:
      "House drinks and late plates, presented plainly enough to choose in low light.",
    afterDarkClosing: "A table, a drink, then one more song.",
    neighborhoodMenuHeading: "What’s on the table.",
    neighborhoodVisitEyebrow: "Come by",
    neighborhoodVisitHeading: "A familiar room. A reserved seat.",
    daylightMenuEyebrow: "From the counter",
    daylightMenuHeading: "Baked today. Ready now.",
    daylightVisitHeading: "Drop in while the light is good.",
    familyMenuEyebrow: "The full menu",
    familyMenuHeading: "Something for everyone.",
    vesperArrivalEyebrow: "The room",
    vesperMenuEyebrow: "Tonight, briefly",
    vesperMenuHeading: "A short menu, read slowly.",
    vesperMenuIntro:
      "Four or five things at a time, written out plainly so the room stays the loudest part of the evening.",
    vesperClosing: "Stay as long as the light does.",
  },
  fr: {
    language: "Langue",
    reservationsVia: "Réservations via",
    bookingPartner: "notre partenaire de réservation",
    seasonalNotice:
      "Le menu et les disponibilités peuvent évoluer au fil des saisons.",
    heroImageAlt: "Salle du restaurant",
    bookingHeading: "Réservations",
    bookingRequestHeading: "Demander une table",
    bookingRequestIntro:
      "Dites-nous quand vous souhaitez venir, nous confirmerons par e-mail ou par téléphone.",
    themePlanVisit: "Planifier une visite",
    themeMenuEyebrow: "La carte",
    terroirMenuHeading: "Guidé par la saison.",
    terroirVisitEyebrow: "À table",
    terroirVisitHeading: "Prenez le temps de savourer tout le menu.",
    themeBrowseMenu: "Voir la carte",
    themeMenuCategories: "Catégories du menu",
    counterMenuEyebrow: "Quand vous voulez",
    counterMenuHeading: "Choisissez votre commande.",
    afterDarkEventsEyebrow: "À l’affiche",
    afterDarkMenuEyebrow: "Cuisine et boissons",
    afterDarkMenuHeading: "Prolongez la soirée.",
    afterDarkMenuIntro:
      "Cocktails maison et assiettes tardives, présentés clairement même en lumière tamisée.",
    afterDarkClosing: "Une table, un verre, puis une chanson de plus.",
    neighborhoodMenuHeading: "Ce qu’il y a sur la table.",
    neighborhoodVisitEyebrow: "Passez nous voir",
    neighborhoodVisitHeading: "Une salle familière. Une place réservée.",
    daylightMenuEyebrow: "Au comptoir",
    daylightMenuHeading: "Cuit aujourd’hui. Prêt maintenant.",
    daylightVisitHeading: "Passez pendant qu’il fait jour.",
    familyMenuEyebrow: "Toute la carte",
    familyMenuHeading: "De quoi contenter tout le monde.",
    vesperArrivalEyebrow: "La salle",
    vesperMenuEyebrow: "Ce soir, brièvement",
    vesperMenuHeading: "Une carte courte, lue lentement.",
    vesperMenuIntro:
      "Quatre ou cinq plats à la fois, écrits simplement pour que la salle reste le plus fort de la soirée.",
    vesperClosing: "Restez aussi longtemps que la lumière.",
  },
} satisfies Record<string, Record<string, string>>;

export const restaurantConfig = {
  id: Vertical.RESTAURANT,
  vocabulary: {
    catalog: "Menu",
    section: "Section",
    item: "Dish",
  },
  marketing: restaurantMarketing,
  claimMode: "niche",
  supportsOwnerReview: true,
  publicationEnabled: true,
  publicationMutationEnabled: true,
  ownerOperations: restaurantOwnerOperations,
  integrationTypes: ["booking", "ordering", "delivery", "social"],
  attributesSchema: restaurantAttributesSchema,
  attributeDefaults: {
    cuisine: "",
    showMenuImages: false,
  },
  deterministicAttributes: {
    cuisine: "",
    showMenuImages: false,
    designProfile: DEFAULT_RESTAURANT_DESIGN_PROFILE,
    themeSelection: selectDeterministicRestaurantTheme(
      DEFAULT_RESTAURANT_DESIGN_PROFILE,
    ),
  },
  itemAttributesSchema: restaurantItemAttributesSchema,
  itemAttributeDefaults: {
    dietaryLabels: [],
  },
  draftSchema: restaurantSiteDraftSchema,
  prompt: restaurantPrompt,
  imageEnhancement: {
    subject: "restaurant photograph",
    contextLabel: "Restaurant",
    forbiddenElements:
      "food, ingredient, garnish, sauce, portion, plating, tableware",
    sceneClause: "make the scene look like a different service",
    fidelityClause: "what the restaurant actually serves or looks like",
    gradeClause:
      "Use a natural hospitality colour grade. Avoid plastic textures, exaggerated saturation, fake steam, fake depth of field, and stock-photo polish.",
  },
  // Sourced from the sample fixture so the read-path fallbacks stay byte-identical
  // to the pre-registry behaviour rather than drifting into a second copy.
  presentation: {
    fallbackDescription: sampleRestaurant.description,
    fallbackPalette: sampleRestaurant.palette,
    buildEyebrow: (attributes, site) =>
      `${attributes.cuisine || "Independent restaurant"} · ${site.address ?? "Local"}`,
    // Dietary labels are the restaurant's badge set. The renderer only receives the
    // resulting strings, so `dietaryLabels` never appears outside this vertical.
    itemBadges: (attributes) => attributes.dietaryLabels,
  },
  templates: {
    definitions: restaurantTemplates,
    resolve: resolveRestaurantTemplateFromAttributes,
  },
  normalizeGeneratedAttributes: (attributes, template) => {
    const theme = normalizeGeneratedRestaurantThemeSelection(
      attributes.designProfile,
      attributes.themeSelection,
    );
    return {
      ...attributes,
      ...theme,
      showMenuImages:
        template.showMenuImagesByDefault ||
        theme.themeSelection.themeId === "counter-service",
    };
  },
  providers: restaurantProviders,
  crawl: {
    relevantPathPattern: restaurantRelevantPathPattern,
    linkKeywordHints: restaurantLinkKeywordHints,
  },
  i18n: restaurantDictionaryExtensions,
  rendererCapabilities: (attributes) => ({
    showGallery: attributes.showMenuImages,
    primaryAction: "booking",
    bookingRequestMode: "when-missing",
  }),
} satisfies VerticalConfig<
  RestaurantAttributes,
  RestaurantItemAttributes,
  RestaurantTemplate,
  RestaurantSiteDraft
>;
