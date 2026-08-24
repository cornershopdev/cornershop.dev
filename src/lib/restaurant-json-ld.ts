import type { SiteDraftView } from "@/lib/site-draft";
import { serializeJsonLd } from "@/lib/json-ld";

export type RestaurantJsonLd = {
  "@context": "https://schema.org";
  "@type": "Restaurant";
  name: string;
  description?: string;
  telephone?: string;
  url?: string;
  servesCuisine?: string;
  address?: {
    "@type": "PostalAddress";
    streetAddress: string;
  };
  openingHours?: string[];
  menu?: string;
  acceptsReservations?: string | boolean;
};

export function buildRestaurantJsonLd(draft: SiteDraftView): RestaurantJsonLd {
  const booking = draft.integrations.find(
    (integration) => integration.enabled && integration.type === "booking",
  );
  const cuisine =
    typeof draft.attributes.cuisine === "string"
      ? draft.attributes.cuisine.trim()
      : "";
  const canonicalUrl = draft.sourceUrl ?? undefined;
  const hasMenu = draft.catalogSections.some((section) => section.items.length > 0);
  const menuUrl = hasMenu && canonicalUrl ? `${stripHash(canonicalUrl)}#menu` : undefined;
  const hours = draft.businessHours
    .map((entry) => `${entry.days} ${entry.hours}`.trim())
    .filter(Boolean);

  const jsonLd: RestaurantJsonLd = {
    "@context": "https://schema.org",
    "@type": "Restaurant",
    name: draft.name,
  };
  if (draft.description.trim()) jsonLd.description = draft.description.trim();
  if (draft.phone.trim()) jsonLd.telephone = draft.phone.trim();
  if (canonicalUrl) jsonLd.url = canonicalUrl;
  if (cuisine) jsonLd.servesCuisine = cuisine;
  if (draft.address.trim()) {
    jsonLd.address = {
      "@type": "PostalAddress",
      streetAddress: draft.address.trim(),
    };
  }
  if (hours.length > 0) jsonLd.openingHours = hours;
  if (menuUrl) jsonLd.menu = menuUrl;
  if (booking) jsonLd.acceptsReservations = booking.url;
  else if (hasMenu) jsonLd.acceptsReservations = false;

  return jsonLd;
}

export function serializeRestaurantJsonLd(draft: SiteDraftView): string {
  return serializeJsonLd(buildRestaurantJsonLd(draft));
}

function stripHash(url: string): string {
  try {
    const parsed = new URL(url);
    parsed.hash = "";
    return parsed.toString();
  } catch {
    return url.split("#")[0] ?? url;
  }
}
