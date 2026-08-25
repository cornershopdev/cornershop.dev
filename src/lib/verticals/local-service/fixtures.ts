import { localServiceSiteDraftSchema } from "@/lib/verticals/local-service/schema";

export const sampleLocalServiceSiteDraft = localServiceSiteDraftSchema.parse({
  slug: "harbour-electrical",
  name: "Harbour Electrical",
  eyebrow: "Qualified electrician · Valletta and the harbour area",
  description:
    "Residential and small-commercial electrical work, from fault finding and repairs to rewires, lighting and compliant new installations.",
  address: "Valletta, Malta",
  phone: "+356 7999 1122",
  email: "hello@harbourelectrical.example",
  sourceUrl: "https://example.com/harbour-electrical",
  logoUrl: null,
  faviconUrl: null,
  heroImageUrl: null,
  heroOriginalImageUrl: null,
  heroImageProvenance: null,
  palette: {
    background: "#f2efe8",
    foreground: "#17201d",
    accent: "#d05b32",
    accentForeground: "#ffffff",
  },
  sourceData: { navigation: [], brandAssets: [], evidence: [] },
  autoEnhanceImages: false,
  defaultLocale: "en",
  businessHours: [
    { days: "Monday–Friday", hours: "08:00–18:00" },
    { days: "Saturday", hours: "08:00–13:00" },
  ],
  attributes: {
    tradeType: "electrician",
    availabilityPosture: "emergency-callout",
    serviceAreas: ["Valletta", "Floriana", "Three Cities"],
    credentials: [
      { name: "Authorised electrician", issuer: "National regulator", reference: "Authorisation stated on source" },
    ],
    insuranceStatus: "insured",
    insuranceDetail: "Public liability insurance stated",
    trustSignals: [
      { label: "12 years in trade", detail: "Stated by the business" },
      { label: "Written estimates", detail: "Before work begins" },
    ],
    projects: [
      { title: "Townhouse rewire", description: "Full rewire and distribution-board replacement in an occupied Valletta townhouse.", imageUrl: null, location: "Valletta" },
      { title: "Workshop lighting", description: "Efficient task lighting and new circuits for a small joinery workshop.", imageUrl: null, location: "Marsa" },
    ],
    showProjectGallery: true,
  },
  translations: [],
  catalogSections: [
    {
      name: "Electrical work",
      description: "Repairs, upgrades and new installations",
      items: [
        { name: "Fault finding and repairs", description: "Diagnosis and repair for tripping circuits, failed sockets and lighting faults.", price: null, currency: "EUR", available: true, imageUrl: null, attributes: { pricingModel: "quote", priceUnit: "", emergencyEligible: true } },
        { name: "Rewires and upgrades", description: "Partial and full rewires, consumer-unit replacement and circuit upgrades.", price: null, currency: "EUR", available: true, imageUrl: null, attributes: { pricingModel: "quote", priceUnit: "", emergencyEligible: false } },
      ],
    },
  ],
  integrations: [
    { type: "contact", label: "Message on WhatsApp", provider: "WhatsApp", url: "https://wa.me/35679991122", enabled: true, venueId: null },
    { type: "quote", label: "Request a written quote", provider: "Existing quote form", url: "https://harbour-electrical.example/quote", enabled: true, venueId: null },
  ],
});
