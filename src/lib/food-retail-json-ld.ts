import type { SiteDraftView } from "@/lib/site-draft";
import { serializeJsonLd } from "@/lib/json-ld";
import type { FoodShopType } from "@/lib/verticals/food-retail/schema";

type FoodRetailBusinessType = "Bakery" | "GroceryStore" | "Store";

export type FoodRetailJsonLd = {
  "@context": "https://schema.org";
  "@type": FoodRetailBusinessType;
  name: string;
  category: string;
  description?: string;
  telephone?: string;
  url?: string;
  image?: string;
  address?: { "@type": "PostalAddress"; streetAddress: string };
  openingHours?: string[];
  potentialAction?: { "@type": "OrderAction"; target: string };
  hasOfferCatalog?: {
    "@type": "OfferCatalog";
    name: string;
    itemListElement: Array<{
      "@type": "OfferCatalog";
      name: string;
      description?: string;
      itemListElement: Array<{
        "@type": "Offer";
        availability?:
          | "https://schema.org/InStock"
          | "https://schema.org/OutOfStock";
        price?: number;
        priceCurrency?: string;
        url?: string;
        itemOffered: {
          "@type": "Product";
          name: string;
          description?: string;
          category: string;
          image?: string;
        };
      }>;
    }>;
  };
};

const categoryLabels: Record<FoodShopType, string> = {
  bakery: "Bakery",
  patisserie: "Patisserie",
  butcher: "Butcher shop",
  deli: "Delicatessen",
  cheesemonger: "Cheesemonger",
  grocer: "Grocery store",
  "local-food-shop": "Local food shop",
};

function businessType(shopType: FoodShopType): FoodRetailBusinessType {
  if (shopType === "bakery" || shopType === "patisserie") return "Bakery";
  if (shopType === "grocer") return "GroceryStore";
  return "Store";
}

export function buildFoodRetailJsonLd(
  draft: SiteDraftView,
): FoodRetailJsonLd {
  const shopType = isFoodShopType(draft.attributes.shopType)
    ? draft.attributes.shopType
    : "local-food-shop";
  const ordering = draft.integrations.find(
    (integration) =>
      integration.enabled &&
      (integration.type === "ordering" || integration.type === "delivery"),
  );
  const category = categoryLabels[shopType];
  const hours = draft.businessHours
    .map((entry) => `${entry.days} ${entry.hours}`.trim())
    .filter(Boolean);
  const catalogSections = draft.catalogSections.flatMap((section) => {
    const items = section.items
      .filter((item) => item.attributes.visible !== false)
      .map((item) => {
        const stockAvailability = sourcedStockAvailability(
          item.available,
          item.attributes,
        );
        const product: {
          "@type": "Product";
          name: string;
          description?: string;
          category: string;
          image?: string;
        } = {
          "@type": "Product",
          name: item.name,
          category: section.name,
        };
        if (item.description.trim()) product.description = item.description.trim();
        if (item.imageUrl?.startsWith("https://")) product.image = item.imageUrl;
        return {
          "@type": "Offer" as const,
          ...(stockAvailability ? { availability: stockAvailability } : {}),
          ...(item.price === null
            ? {}
            : { price: item.price, priceCurrency: item.currency }),
          ...(ordering ? { url: ordering.url } : {}),
          itemOffered: product,
        };
      });
    if (items.length === 0) return [];
    return [
      {
        "@type": "OfferCatalog" as const,
        name: section.name,
        ...(section.description.trim()
          ? { description: section.description.trim() }
          : {}),
        itemListElement: items,
      },
    ];
  });

  const jsonLd: FoodRetailJsonLd = {
    "@context": "https://schema.org",
    "@type": businessType(shopType),
    name: draft.name,
    category,
  };
  if (draft.description.trim()) jsonLd.description = draft.description.trim();
  if (draft.phone.trim()) jsonLd.telephone = draft.phone.trim();
  if (draft.sourceUrl) jsonLd.url = draft.sourceUrl;
  if (draft.heroImageUrl?.startsWith("https://")) {
    jsonLd.image = draft.heroImageUrl;
  }
  if (draft.address.trim()) {
    jsonLd.address = {
      "@type": "PostalAddress",
      streetAddress: draft.address.trim(),
    };
  }
  if (hours.length > 0) jsonLd.openingHours = hours;
  if (ordering) {
    jsonLd.potentialAction = { "@type": "OrderAction", target: ordering.url };
  }
  if (catalogSections.length > 0) {
    jsonLd.hasOfferCatalog = {
      "@type": "OfferCatalog",
      name: "Product ranges",
      itemListElement: catalogSections,
    };
  }
  return jsonLd;
}

export function serializeFoodRetailJsonLd(draft: SiteDraftView): string {
  return serializeJsonLd(buildFoodRetailJsonLd(draft));
}

function isFoodShopType(value: unknown): value is FoodShopType {
  return (
    typeof value === "string" &&
    [
      "bakery",
      "patisserie",
      "butcher",
      "deli",
      "cheesemonger",
      "grocer",
      "local-food-shop",
    ].includes(value)
  );
}

function sourcedStockAvailability(
  available: boolean | null,
  attributes: Record<string, unknown>,
):
  | "https://schema.org/InStock"
  | "https://schema.org/OutOfStock"
  | null {
  if (typeof attributes.stockSourceUrl !== "string") return null;
  if (available === true) {
    return "https://schema.org/InStock";
  }
  if (available === false) {
    return "https://schema.org/OutOfStock";
  }
  return null;
}
