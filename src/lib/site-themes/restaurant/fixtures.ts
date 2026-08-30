import type { z } from "zod";
import {
  restaurantDesignProfileSchema,
  type RestaurantDesignProfile,
  type RestaurantThemeId,
} from "@/lib/site-themes/restaurant/contracts";
import { selectDeterministicRestaurantTheme } from "@/lib/site-themes/restaurant/selection";
import {
  restaurantSiteDraftSchema,
  type RestaurantSiteDraft,
} from "@/lib/verticals/restaurant/schema";

export type RestaurantThemeFixture = RestaurantSiteDraft & {
  profile: RestaurantDesignProfile;
};

function fixture(
  draft: Omit<
    z.input<typeof restaurantSiteDraftSchema>,
    "attributes" | "autoEnhanceImages"
  > & {
    cuisine: string;
    profile: RestaurantDesignProfile;
  },
): RestaurantThemeFixture {
  const { cuisine, profile, ...site } = draft;
  const themeSelection = selectDeterministicRestaurantTheme(profile);
  const parsedDraft = restaurantSiteDraftSchema.parse({
    ...site,
    autoEnhanceImages: false,
    attributes: {
      cuisine,
      showMenuImages: true,
      designProfile: profile,
      themeSelection,
    },
  });

  return {
    ...parsedDraft,
    profile,
  };
}

const terroirProfile = restaurantDesignProfileSchema.parse({
  serviceModel: "fine-dining",
  primaryIntent: "reserve",
  menuExperience: "editorial",
  brandTraits: ["craft", "minimal"],
  pricePosition: "premium",
  locationCount: 1,
  photographyQuality: "strong",
});

const counterProfile = restaurantDesignProfileSchema.parse({
  serviceModel: "fast-casual",
  primaryIntent: "order",
  menuExperience: "commerce",
  brandTraits: ["energetic", "playful"],
  pricePosition: "value",
  locationCount: 3,
  photographyQuality: "strong",
});

const afterDarkProfile = restaurantDesignProfileSchema.parse({
  serviceModel: "bar-nightlife",
  primaryIntent: "reserve",
  menuExperience: "catalog",
  brandTraits: ["atmospheric", "classic"],
  pricePosition: "premium",
  locationCount: 1,
  photographyQuality: "strong",
});

export const restaurantThemeFixtures: Record<
  RestaurantThemeId,
  RestaurantThemeFixture
> = {
  "terroir-editorial": fixture({
    slug: "maison-serein",
    name: "Maison Serein",
    eyebrow: "Field, fire and the Maltese season",
    description:
      "A twelve-table dining room shaped by local growers, the day’s catch and a menu that changes whenever the island does.",
    cuisine: "Seasonal Mediterranean",
    address: "8 Triq il-Lvant, Rabat, Malta",
    phone: "+356 2100 1840",
    sourceUrl: null,
    heroImageUrl: "/themes/restaurant/terroir-editorial.webp",
    palette: {
      background: "#f2eee4",
      foreground: "#20231f",
      accent: "#7f3f2e",
    },
  defaultLocale: "en",
  businessHours: [],
    profile: terroirProfile,
    catalogSections: [
      {
        name: "Early summer",
        description: "A short menu served as four or seven courses",
        items: [
          {
            name: "Broad bean & sheep’s curd",
            description: "Green almond, preserved lemon, young herbs",
            price: 18,
            currency: "EUR",
            imageUrl: null,
            attributes: { dietaryLabels: ["vegetarian"] },
          },
          {
            name: "Line-caught lampuki",
            description: "Fennel pollen, grilled leaves, shellfish broth",
            price: 34,
            currency: "EUR",
            imageUrl: null,
            attributes: { dietaryLabels: ["gluten-free"] },
          },
          {
            name: "Seven-course table",
            description: "The full seasonal menu for the whole table",
            price: 92,
            currency: "EUR",
            imageUrl: null,
            attributes: { dietaryLabels: [] },
          },
        ],
      },
    ],
    integrations: [
      {
        type: "booking",
        label: "Reserve a table",
        provider: "SevenRooms",
        url: "https://www.sevenrooms.com",
        venueId: null,
      },
    ],
    translations: [],
  }),
  "counter-service": fixture({
    slug: "fold-pizza",
    name: "Fold Pizza",
    eyebrow: "Slices, whole pies, no detours",
    description:
      "A neighbourhood counter for blistered sourdough pizza, cold drinks and fast collection from lunch until late.",
    cuisine: "Modern Italian",
    address: "41 Old Theatre Street, Valletta, Malta",
    phone: "+356 2100 2550",
    sourceUrl: null,
    heroImageUrl: "/themes/restaurant/counter-service.webp",
    palette: {
      background: "#fff7df",
      foreground: "#172118",
      accent: "#d13a22",
    },
  defaultLocale: "en",
  businessHours: [],
    profile: counterProfile,
    catalogSections: [
      {
        name: "Slices",
        description: "Cut to order from midday",
        items: [
          {
            name: "Tomato & pecorino",
            description: "Slow tomato, garlic oil, oregano, aged pecorino",
            price: 5,
            currency: "EUR",
            imageUrl: null,
            attributes: { dietaryLabels: ["vegetarian"] },
          },
          {
            name: "Spicy fennel",
            description: "Fennel sausage, chilli, mozzarella, spring onion",
            price: 6.5,
            currency: "EUR",
            imageUrl: null,
            attributes: { dietaryLabels: [] },
          },
        ],
      },
      {
        name: "Whole pies",
        description: "Twelve-inch sourdough pizzas",
        items: [
          {
            name: "The red one",
            description: "Tomato, confit garlic, basil, olive oil",
            price: 14,
            currency: "EUR",
            imageUrl: null,
            attributes: { dietaryLabels: ["vegan"] },
          },
          {
            name: "Potato & rosemary",
            description: "New potato, smoked mozzarella, rosemary, sea salt",
            price: 17,
            currency: "EUR",
            imageUrl: null,
            attributes: { dietaryLabels: ["vegetarian"] },
          },
        ],
      },
    ],
    integrations: [
      {
        type: "ordering",
        label: "Order for collection",
        provider: "Existing ordering",
        url: "https://fold-pizza.example/order",
        venueId: null,
      },
      {
        type: "delivery",
        label: "Get delivery",
        provider: "Existing delivery",
        url: "https://fold-pizza.example/delivery",
        venueId: null,
      },
    ],
    translations: [],
  }),
  "after-dark": fixture({
    slug: "nightjar-room",
    name: "Nightjar Room",
    eyebrow: "Cocktails, small plates and a midnight set",
    description:
      "An intimate bar and late dining room with live sessions, thoughtful drinks and tables held well into the night.",
    cuisine: "Cocktail bar & late dining",
    address: "12 Strait Street, Valletta, Malta",
    phone: "+356 2100 0312",
    sourceUrl: null,
    heroImageUrl: "/themes/restaurant/after-dark.webp",
    palette: {
      background: "#111010",
      foreground: "#f5efe4",
      accent: "#e85d3f",
    },
  defaultLocale: "en",
  businessHours: [],
    profile: afterDarkProfile,
    catalogSections: [
      {
        name: "House drinks",
        description: "Built for the room, poured until close",
        items: [
          {
            name: "Velvet Hour",
            description: "Rye, fig leaf, dry vermouth, walnut",
            price: 14,
            currency: "EUR",
            imageUrl: null,
            attributes: { dietaryLabels: [] },
          },
          {
            name: "Garden After Rain",
            description: "Gin, lovage, green apple, sparkling wine",
            price: 13,
            currency: "EUR",
            imageUrl: null,
            attributes: { dietaryLabels: ["vegan"] },
          },
        ],
      },
      {
        name: "Late plates",
        description: "From the kitchen until midnight",
        items: [
          {
            name: "Charred oyster mushrooms",
            description: "Black garlic, sesame, crisp shallot",
            price: 12,
            currency: "EUR",
            imageUrl: null,
            attributes: { dietaryLabels: ["vegan"] },
          },
          {
            name: "Short rib toast",
            description: "Braised beef, horseradish, pickled onion",
            price: 16,
            currency: "EUR",
            imageUrl: null,
            attributes: { dietaryLabels: [] },
          },
        ],
      },
    ],
    integrations: [
      {
        type: "booking",
        label: "Book tonight",
        provider: "Resy",
        url: "https://resy.com",
        venueId: null,
      },
      {
        type: "social",
        label: "Tonight’s programme",
        provider: "Instagram",
        url: "https://instagram.com",
        venueId: null,
      },
    ],
    translations: [],
  }),
  "neighborhood-table": fixture({
    slug: "marina-kitchen",
    name: "Marina Kitchen",
    eyebrow: "Harbour tables since 1998",
    description:
      "A neighbourhood dining room for grilled fish, shared plates and evenings that start with a reserved table by the water.",
    cuisine: "Mediterranean",
    address: "3 Triq ix-Xatt, Sliema, Malta",
    phone: "+356 2100 4410",
    sourceUrl: null,
    heroImageUrl: "/themes/restaurant/neighborhood-table.webp",
    palette: {
      background: "#f7f1e8",
      foreground: "#2a241c",
      accent: "#b54a2f",
    },
    defaultLocale: "en",
    businessHours: [],
    profile: restaurantDesignProfileSchema.parse({
      serviceModel: "full-service",
      primaryIntent: "reserve",
      menuExperience: "catalog",
      brandTraits: ["classic", "craft"],
      pricePosition: "midmarket",
      locationCount: 1,
      photographyQuality: "strong",
    }),
    catalogSections: [
      {
        name: "Starters",
        description: "Shared plates to open the table",
        items: [
          {
            name: "Tomato & bread salad",
            description: "Ripe tomatoes, day-old loaf, capers, basil oil",
            price: 11,
            currency: "EUR",
            imageUrl: null,
            attributes: { dietaryLabels: ["vegan"] },
          },
          {
            name: "Grilled octopus",
            description: "Smoked paprika, lemon, soft herbs",
            price: 16,
            currency: "EUR",
            imageUrl: null,
            attributes: { dietaryLabels: ["gluten-free"] },
          },
        ],
      },
      {
        name: "Mains",
        description: "From the grill and the pan",
        items: [
          {
            name: "Catch of the day",
            description: "Market fish, olive oil, seasonal greens",
            price: 28,
            currency: "EUR",
            imageUrl: null,
            attributes: { dietaryLabels: ["gluten-free"] },
          },
          {
            name: "Slow lamb shoulder",
            description: "Rosemary, garlic, soft polenta",
            price: 26,
            currency: "EUR",
            imageUrl: null,
            attributes: { dietaryLabels: [] },
          },
        ],
      },
    ],
    integrations: [
      {
        type: "booking",
        label: "Reserve a table",
        provider: "TheFork",
        url: "https://www.thefork.com",
        venueId: null,
      },
    ],
    translations: [],
  }),
  "daylight-cafe": fixture({
    slug: "harbour-loaf",
    name: "Harbour Loaf",
    eyebrow: "Bread, coffee, morning light",
    description:
      "A bright bakery cafe for laminated pastries, lunch sandwiches and coffee that carries the rest of the day.",
    cuisine: "Bakery & cafe",
    address: "22 Triq San Ġwann, Valletta, Malta",
    phone: "+356 2100 7721",
    sourceUrl: null,
    heroImageUrl: "/themes/restaurant/daylight-cafe.webp",
    palette: {
      background: "#fbf7f0",
      foreground: "#3a3228",
      accent: "#c4783a",
    },
    defaultLocale: "en",
    businessHours: [],
    profile: restaurantDesignProfileSchema.parse({
      serviceModel: "cafe-bakery",
      primaryIntent: "visit",
      menuExperience: "catalog",
      brandTraits: ["craft", "minimal"],
      pricePosition: "midmarket",
      locationCount: 2,
      photographyQuality: "strong",
    }),
    catalogSections: [
      {
        name: "From the oven",
        description: "Baked through the morning",
        items: [
          {
            name: "Butter croissant",
            description: "Laminated dough, sea salt",
            price: 3.2,
            currency: "EUR",
            imageUrl: null,
            attributes: { dietaryLabels: ["vegetarian"] },
          },
          {
            name: "Sourdough loaf",
            description: "Overnight ferment, wheat and rye",
            price: 4.5,
            currency: "EUR",
            imageUrl: null,
            attributes: { dietaryLabels: ["vegan"] },
          },
        ],
      },
      {
        name: "Lunch",
        description: "Made to order until mid-afternoon",
        items: [
          {
            name: "Tomato & ricotta toast",
            description: "Sourdough, olive oil, soft herbs",
            price: 8.5,
            currency: "EUR",
            imageUrl: null,
            attributes: { dietaryLabels: ["vegetarian"] },
          },
          {
            name: "Chicken salad roll",
            description: "Poached chicken, crisp lettuce, mustard mayo",
            price: 9.5,
            currency: "EUR",
            imageUrl: null,
            attributes: { dietaryLabels: [] },
          },
        ],
      },
    ],
    integrations: [
      {
        type: "ordering",
        label: "Order for collection",
        provider: "Existing ordering",
        url: "https://harbour-loaf.example/order",
        venueId: null,
      },
    ],
    translations: [],
  }),
  "family-feast": fixture({
    slug: "olive-branch",
    name: "Olive Branch",
    eyebrow: "Family tables in three towns",
    description:
      "A familiar kitchen for shared mezze, grilled meats and birthdays that run long—open for lunch and dinner across three neighbourhood rooms.",
    cuisine: "Eastern Mediterranean",
    address: "15 Triq il-Kbira, Birkirkara, Malta",
    phone: "+356 2100 9904",
    sourceUrl: null,
    heroImageUrl: "/themes/restaurant/family-feast.webp",
    palette: {
      background: "#fffdf8",
      foreground: "#1f2a24",
      accent: "#2f6b4f",
    },
    defaultLocale: "en",
    businessHours: [],
    profile: restaurantDesignProfileSchema.parse({
      serviceModel: "full-service",
      primaryIntent: "visit",
      menuExperience: "catalog",
      brandTraits: ["classic", "playful"],
      pricePosition: "midmarket",
      locationCount: 3,
      photographyQuality: "limited",
    }),
    catalogSections: [
      {
        name: "Mezze",
        description: "To share across the table",
        items: [
          {
            name: "Hummus & warm pita",
            description: "Tahini, lemon, olive oil",
            price: 7,
            currency: "EUR",
            imageUrl: null,
            attributes: { dietaryLabels: ["vegan"] },
          },
          {
            name: "Halloumi fries",
            description: "Mint yoghurt, sumac",
            price: 9,
            currency: "EUR",
            imageUrl: null,
            attributes: { dietaryLabels: ["vegetarian"] },
          },
        ],
      },
      {
        name: "Grills",
        description: "From the charcoal",
        items: [
          {
            name: "Chicken shish",
            description: "Yoghurt marinade, grilled pepper, rice",
            price: 15,
            currency: "EUR",
            imageUrl: null,
            attributes: { dietaryLabels: ["gluten-free"] },
          },
          {
            name: "Mixed grill for two",
            description: "Lamb, chicken, kofte, salad, bread",
            price: 34,
            currency: "EUR",
            imageUrl: null,
            attributes: { dietaryLabels: [] },
          },
        ],
      },
    ],
    integrations: [
      {
        type: "booking",
        label: "Book a table",
        provider: "OpenTable",
        url: "https://www.opentable.com",
        venueId: null,
      },
      {
        type: "ordering",
        label: "Order takeaway",
        provider: "Existing ordering",
        url: "https://olive-branch.example/order",
        venueId: null,
      },
    ],
    translations: [],
  }),
  "vesper-room": fixture({
    slug: "hollow-lantern",
    name: "Hollow Lantern",
    eyebrow: "A room lit for staying",
    description:
      "A low-lit dining room above the harbour where the menu is short, the light is warm and nobody is asked to hurry.",
    cuisine: "Modern European",
    address: "8 Triq San Pawl, Mdina, Malta",
    phone: "+356 2100 7788",
    sourceUrl: null,
    heroImageUrl: "/themes/restaurant/vesper-room.webp",
    palette: {
      background: "#14101a",
      foreground: "#f2ece2",
      accent: "#c9a86a",
    },
    defaultLocale: "en",
    businessHours: [],
    profile: restaurantDesignProfileSchema.parse({
      serviceModel: "fine-dining",
      primaryIntent: "visit",
      menuExperience: "editorial",
      brandTraits: ["atmospheric", "minimal"],
      pricePosition: "premium",
      locationCount: 1,
      photographyQuality: "strong",
    }),
    catalogSections: [
      {
        name: "To begin",
        description: "Small things, brought while you settle in",
        items: [
          {
            name: "Bread, cultured butter",
            description: "Sourdough baked at four, salt from Xwejni",
            price: 6,
            currency: "EUR",
            imageUrl: null,
            attributes: { dietaryLabels: ["vegetarian"] },
          },
          {
            name: "Marinated olives, orange peel",
            description: "Bitter orange, fennel seed, chilli",
            price: 5,
            currency: "EUR",
            imageUrl: null,
            attributes: { dietaryLabels: ["vegan"] },
          },
        ],
      },
      {
        name: "The long middle",
        description: "Four plates, changed when the market changes",
        items: [
          {
            name: "Lampuki, brown butter, capers",
            description: "Line-caught, roasted on the bone",
            price: 26,
            currency: "EUR",
            imageUrl: null,
            attributes: { dietaryLabels: [] },
          },
          {
            name: "Broad beans, mint, pecorino",
            description: "Podded the same morning",
            price: 18,
            currency: "EUR",
            imageUrl: null,
            attributes: { dietaryLabels: ["vegetarian"] },
          },
        ],
      },
    ],
    integrations: [
      {
        type: "social",
        label: "The room, most evenings",
        provider: "Instagram",
        url: "https://instagram.com",
        venueId: null,
      },
    ],
    translations: [],
  }),
};

export function getRestaurantThemeFixture(
  id: RestaurantThemeId,
): RestaurantThemeFixture {
  return restaurantThemeFixtures[id];
}
