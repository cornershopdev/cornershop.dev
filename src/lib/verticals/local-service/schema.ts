import { z } from "zod";
import {
  assertSiteDraftInvariants,
  baseSiteDraftCoreShape,
  baseSiteTranslationSchema,
  catalogItemSchema,
  catalogSectionSchema,
  imageProvenanceSchema,
  integrationSchema,
  siteImageUrlSchema,
  translatedCatalogItemSchema,
  translatedCatalogSectionSchema,
} from "@/lib/verticals/schema";

export const localServiceTradeTypeSchema = z.enum([
  "plumber",
  "electrician",
  "builder",
  "repair",
  "artisan",
  "general-trades",
]);

export const availabilityPostureSchema = z.enum([
  "not-stated",
  "scheduled",
  "same-day",
  "emergency-callout",
  "24-7-emergency",
  "by-appointment",
]);

export const localServiceCredentialSchema = z.object({
  name: z.string().trim().min(1).max(100),
  issuer: z.string().trim().max(100).default(""),
  reference: z.string().trim().max(80).default(""),
});

export const localServiceTrustSignalSchema = z.object({
  label: z.string().trim().min(1).max(80),
  detail: z.string().trim().max(140).default(""),
});

export const localServiceProjectSchema = z
  .object({
    title: z.string().trim().min(1).max(100),
    description: z.string().trim().max(320).default(""),
    imageUrl: siteImageUrlSchema
      .refine(
        (value) =>
          value.startsWith("/") || new URL(value).protocol === "https:",
        "Project images must use HTTPS or a local asset path",
      )
      .nullable()
      .default(null),
    originalImageUrl: siteImageUrlSchema.nullable().optional(),
    imageProvenance: imageProvenanceSchema.nullable().optional(),
    location: z.string().trim().max(100).default(""),
  })
  .superRefine((project, context) => {
    if (project.imageUrl && !project.imageProvenance) {
      context.addIssue({
        code: "custom",
        path: ["imageProvenance"],
        message: "A project image requires recorded provenance",
      });
    }
  });

export const localServiceAttributesSchema = z.object({
  tradeType: localServiceTradeTypeSchema.default("general-trades"),
  availabilityPosture: availabilityPostureSchema.default("not-stated"),
  serviceAreas: z.array(z.string().trim().min(1).max(100)).max(24).default([]),
  credentials: z.array(localServiceCredentialSchema).max(16).default([]),
  insuranceStatus: z
    .enum(["not-stated", "insured", "not-insured"])
    .default("not-stated"),
  insuranceDetail: z.string().trim().max(160).default(""),
  trustSignals: z.array(localServiceTrustSignalSchema).max(16).default([]),
  projects: z.array(localServiceProjectSchema).max(24).default([]),
  showProjectGallery: z.boolean().default(true),
});

export const localServiceItemAttributesSchema = z.object({
  pricingModel: z
    .enum(["not-stated", "fixed", "from", "hourly", "quote"])
    .default("not-stated"),
  priceUnit: z.string().trim().max(40).default(""),
  emergencyEligible: z.boolean().default(false),
});

export const localServiceIntegrationSchema = integrationSchema.extend({
  type: z.enum(["quote", "contact", "booking", "social"]),
});

const localServiceSiteTranslationSchema = baseSiteTranslationSchema.extend({
  attributes: z.object({}),
  catalogSections: z.array(
    translatedCatalogSectionSchema.extend({
      items: z.array(
        translatedCatalogItemSchema.extend({ attributes: z.object({}) }),
      ),
    }),
  ),
});

export const localServiceSiteDraftSchema = z
  .object({
    ...baseSiteDraftCoreShape,
    attributes: localServiceAttributesSchema,
    integrations: z.array(localServiceIntegrationSchema).max(12),
    translations: z
      .array(localServiceSiteTranslationSchema)
      .max(8)
      .default([]),
    catalogSections: z
      .array(
        catalogSectionSchema.extend({
          items: z
            .array(
              catalogItemSchema.extend({
                attributes: localServiceItemAttributesSchema,
              }),
            )
            .max(40),
        }),
      )
      .min(1)
      .max(12),
  })
  .superRefine(assertSiteDraftInvariants);

export type LocalServiceTradeType = z.infer<
  typeof localServiceTradeTypeSchema
>;
export type LocalServiceAttributes = z.infer<
  typeof localServiceAttributesSchema
>;
export type LocalServiceItemAttributes = z.infer<
  typeof localServiceItemAttributesSchema
>;
export type LocalServiceSiteDraft = z.infer<
  typeof localServiceSiteDraftSchema
>;
