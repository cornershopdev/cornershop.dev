import type { SiteDraftView } from "@/lib/site-draft";
import { serializeJsonLd } from "@/lib/json-ld";

const schemaTypes = {
  plumber: "Plumber",
  electrician: "Electrician",
  builder: "GeneralContractor",
  repair: "HomeAndConstructionBusiness",
  artisan: "ProfessionalService",
  "general-trades": "HomeAndConstructionBusiness",
} as const;

const schemaDayCodes: Record<string, string> = {
  monday: "Mo",
  mon: "Mo",
  lundi: "Mo",
  tuesday: "Tu",
  tue: "Tu",
  mardi: "Tu",
  wednesday: "We",
  wed: "We",
  mercredi: "We",
  thursday: "Th",
  thu: "Th",
  jeudi: "Th",
  friday: "Fr",
  fri: "Fr",
  vendredi: "Fr",
  saturday: "Sa",
  sat: "Sa",
  samedi: "Sa",
  sunday: "Su",
  sun: "Su",
  dimanche: "Su",
};

type LocalServiceJsonLd = {
  "@context": "https://schema.org";
  "@type": string;
  name: string;
  description?: string;
  telephone?: string;
  email?: string;
  url?: string;
  logo?: string;
  image?: string;
  address?: { "@type": "PostalAddress"; streetAddress: string };
  openingHours?: string[];
  areaServed?: Array<{ "@type": "Place"; name: string }>;
  hasCredential?: Array<{
    "@type": "EducationalOccupationalCredential";
    credentialCategory: string;
    recognizedBy?: { "@type": "Organization"; name: string };
  }>;
  makesOffer?: Array<{
    "@type": "Offer";
    itemOffered: { "@type": "Service"; name: string; description?: string };
  }>;
  sameAs?: string[];
  potentialAction?: Array<{
    "@type": "CommunicateAction";
    name: string;
    target: string;
  }>;
};

export function buildLocalServiceJsonLd(
  draft: SiteDraftView,
): LocalServiceJsonLd {
  const attributes = record(draft.attributes);
  const tradeType =
    typeof attributes.tradeType === "string" &&
    attributes.tradeType in schemaTypes
      ? (attributes.tradeType as keyof typeof schemaTypes)
      : "general-trades";
  const serviceAreas = stringArray(attributes.serviceAreas);
  const credentials = objectArray(attributes.credentials);
  const services = draft.catalogSections.flatMap((section) =>
    section.items
      .filter((item) => item.available !== false)
      .map((item) => ({
        "@type": "Offer" as const,
        itemOffered: {
          "@type": "Service" as const,
          name: item.name,
          ...(item.description.trim()
            ? { description: item.description.trim() }
            : {}),
        },
      })),
  );
  const actions = draft.integrations
    .filter(
      (integration) =>
        integration.enabled &&
        (integration.type === "quote" || integration.type === "contact"),
    )
    .map((integration) => ({
      "@type": "CommunicateAction" as const,
      name: integration.label,
      target: integration.url,
    }));
  const socialLinks = draft.integrations
    .filter(
      (integration) => integration.enabled && integration.type === "social",
    )
    .map((integration) => integration.url);
  const hours = draft.businessHours.flatMap((entry) => {
    const canonical = canonicalOpeningHours(entry.days, entry.hours);
    return canonical ? [canonical] : [];
  });

  return compact({
    "@context": "https://schema.org",
    "@type": schemaTypes[tradeType],
    name: draft.name,
    description: draft.description.trim() || undefined,
    telephone: draft.phone.trim() || undefined,
    email: draft.email?.trim() || undefined,
    url: draft.sourceUrl ?? undefined,
    logo: draft.logoUrl ?? undefined,
    image: draft.heroImageUrl ?? undefined,
    address: draft.address.trim()
      ? { "@type": "PostalAddress", streetAddress: draft.address.trim() }
      : undefined,
    openingHours: hours.length > 0 ? hours : undefined,
    areaServed:
      serviceAreas.length > 0
        ? serviceAreas.map((name) => ({ "@type": "Place", name }))
        : undefined,
    hasCredential:
      credentials.length > 0
        ? credentials.flatMap((credential) => {
            const name = text(credential.name);
            if (!name) return [];
            const issuer = text(credential.issuer);
            return [
              {
                "@type": "EducationalOccupationalCredential" as const,
                credentialCategory: name,
                ...(issuer
                  ? {
                      recognizedBy: {
                        "@type": "Organization" as const,
                        name: issuer,
                      },
                    }
                  : {}),
              },
            ];
          })
        : undefined,
    makesOffer: services.length > 0 ? services : undefined,
    sameAs: socialLinks.length > 0 ? socialLinks : undefined,
    potentialAction: actions.length > 0 ? actions : undefined,
  });
}

function canonicalOpeningHours(days: string, hours: string): string | null {
  const canonicalDays = schemaOpeningDays(days);
  const timeRange = hours.trim().match(
    /^([01]?\d|2[0-3]):([0-5]\d)\s*[-–—]\s*([01]?\d|2[0-3]):([0-5]\d)$/,
  );
  if (!canonicalDays || !timeRange) return null;
  const [, openHour, openMinute, closeHour, closeMinute] = timeRange;
  const opens = `${openHour.padStart(2, "0")}:${openMinute}`;
  const closes = `${closeHour.padStart(2, "0")}:${closeMinute}`;
  return `${canonicalDays} ${opens}-${closes}`;
}

function schemaOpeningDays(value: string): string | null {
  const normalized = value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
  if (/^(?:every day|daily|tous les jours)$/.test(normalized)) return "Mo-Su";

  const range = normalized.match(
    /^(?:du\s+)?([a-z]+)\s*(?:-|–|—|to|through|au)\s*([a-z]+)$/,
  );
  if (range?.[1] && range[2]) {
    const start = schemaDayCodes[range[1]];
    const end = schemaDayCodes[range[2]];
    return start && end ? `${start}-${end}` : null;
  }

  const parts = normalized
    .split(/\s*(?:,|;|&|\band\b|\bet\b)\s*/)
    .filter(Boolean);
  if (parts.length === 0) return null;
  const codes = parts.map((part) => schemaDayCodes[part]);
  return codes.every(Boolean) ? codes.join(",") : null;
}

export function serializeLocalServiceJsonLd(draft: SiteDraftView): string {
  return serializeJsonLd(buildLocalServiceJsonLd(draft));
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function objectArray(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value) ? value.map(record).filter(Boolean) : [];
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function compact<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined),
  ) as T;
}
