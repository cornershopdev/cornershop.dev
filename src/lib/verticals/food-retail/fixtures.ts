import { foodRetailSiteDraftSchema } from "@/lib/verticals/food-retail/schema";

/**
 * Explicit demo/test evidence, never an import fallback for an owner slug. The
 * allergen source is attached to the one product that carries allergen labels.
 */
export const sampleFoodRetailDraft = foodRetailSiteDraftSchema.parse({
  slug: "maison-levain",
  name: "Maison Levain",
  eyebrow: "Neighbourhood bakery · Valletta",
  description:
    "A small neighbourhood bakery with a daily bread range and weekend pastries available for shop pickup.",
  address: "21 Market Street, Valletta, Malta",
  phone: "+356 2100 2000",
  sourceUrl: "https://example.com/maison-levain",
  heroImageUrl:
    "https://images.unsplash.com/photo-1509440159596-0249088772ff?auto=format&fit=crop&w=1800&q=88",
  heroOriginalImageUrl:
    "https://images.unsplash.com/photo-1509440159596-0249088772ff?auto=format&fit=crop&w=1800&q=88",
  heroImageProvenance: "owner",
  palette: {
    background: "#f5efe3",
    foreground: "#2a2118",
    accent: "#a34f2d",
  },
  attributes: {
    shopType: "bakery",
    showProductImages: true,
    pickupDetails: "Order online for pickup at the Market Street shop.",
  },
  autoEnhanceImages: false,
  defaultLocale: "en",
  businessHours: [
    { days: "Monday–Friday", hours: "07:00–16:00" },
    { days: "Saturday", hours: "08:00–14:00" },
  ],
  translations: [
    {
      locale: "fr",
      status: "current",
      eyebrow: "Boulangerie de quartier · La Valette",
      description:
        "Une petite boulangerie de quartier avec une gamme quotidienne de pains et des viennoiseries le week-end, à retirer en boutique.",
      attributes: {
        pickupDetails:
          "Commandez en ligne et retirez votre commande à la boutique de Market Street.",
      },
      catalogSections: [
        {
          name: "Pains du jour",
          description: "Pétris et cuits sur place.",
          items: [
            {
              name: "Pain au levain de campagne",
              description: "Levain naturel et farine de blé.",
              attributes: {
                seasonalAvailability: "",
                preorderNote: "",
                allergens: ["gluten"],
              },
            },
          ],
        },
        {
          name: "Week-end",
          description: "Disponibilité saisonnière indiquée par la boutique.",
          items: [
            {
              name: "Tarte aux abricots",
              description: "Disponible pendant la saison des abricots.",
              attributes: {
                seasonalAvailability: "Saison des abricots uniquement",
                preorderNote: "Commander avant vendredi midi",
                allergens: [],
              },
            },
          ],
        },
      ],
      integrationLabels: ["Commander pour retrait"],
    },
  ],
  catalogSections: [
    {
      name: "Daily breads",
      description: "Mixed and baked in the shop.",
      items: [
        {
          name: "Country sourdough",
          description: "Natural starter and wheat flour.",
          price: 5.5,
          currency: "EUR",
          available: true,
          imageUrl: null,
          attributes: {
            visible: true,
            stockSourceUrl:
              "https://example.com/maison-levain/daily-breads",
            seasonalAvailability: "",
            preorderRequired: null,
            preorderNote: "",
            allergens: ["gluten"],
            allergenSourceUrl:
              "https://example.com/maison-levain/allergens",
          },
        },
      ],
    },
    {
      name: "Weekend counter",
      description: "Seasonal availability as published by the shop.",
      items: [
        {
          name: "Apricot tart",
          description: "Available during apricot season.",
          price: null,
          currency: "EUR",
          available: null,
          imageUrl: null,
          attributes: {
            visible: true,
            stockSourceUrl: null,
            seasonalAvailability: "Apricot season only",
            preorderRequired: true,
            preorderNote: "Order by Friday noon",
            allergens: [],
            allergenSourceUrl: null,
          },
        },
      ],
    },
  ],
  integrations: [
    {
      type: "ordering",
      label: "Preorder for pickup",
      provider: "Existing ordering",
      url: "https://maison-levain.example/order",
      enabled: true,
      venueId: null,
    },
  ],
});
