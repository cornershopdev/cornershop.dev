import { createHash } from "node:crypto";
import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import type { Vertical } from "@/generated/prisma/enums";
import type { ExtractedSite } from "@/lib/importer";
import type { PersistableSiteDraft } from "@/lib/site-persistence";
import { resolveVerticalConfig } from "@/lib/verticals/registry";
import {
  businessHoursSchema,
  catalogItemSchema,
  catalogSectionSchema,
  integrationSchema,
} from "@/lib/verticals/schema";

export type MonitoringField = "MENU" | "CONTACT" | "HOURS" | "LINKS";

export type SourceEvidence = {
  url: string;
  excerpt: string;
  capturedAt: string;
  contentDigest: string;
};

export type MonitoringSuggestionInput = {
  fingerprint: string;
  field: MonitoringField;
  path: string;
  currentValue: Prisma.InputJsonValue;
  suggestedValue: Prisma.InputJsonValue;
  evidence: SourceEvidence[];
};

export type SourceMonitoringDashboardDto = {
  cadenceDays: number | null;
  nextRunAt: string | null;
  lastRunAt: string | null;
  lastSuccessAt: string | null;
  lastFailureAt: string | null;
  lastFailureCode: string | null;
  latestRun: {
    id: string;
    status: string;
    scheduledFor: string;
    completedAt: string | null;
    suggestionCount: number;
    checkedSourceCount: number;
    failedSourceCount: number;
    notificationFailureCode: string | null;
  } | null;
  suggestions: Array<{
    id: string;
    field: MonitoringField;
    path: string;
    currentValue: unknown;
    suggestedValue: unknown;
    editedValue: unknown;
    evidence: SourceEvidence[];
    status: string;
    createdAt: string;
  }>;
};

export const EMPTY_SOURCE_MONITORING_DASHBOARD: SourceMonitoringDashboardDto = {
  cadenceDays: null,
  nextRunAt: null,
  lastRunAt: null,
  lastSuccessAt: null,
  lastFailureAt: null,
  lastFailureCode: null,
  latestRun: null,
  suggestions: [],
};

export class SourceMonitoringUnsupportedSuggestionError extends Error {
  readonly issues: string[];

  constructor(error?: z.ZodError) {
    const issues = error?.issues.map((issue) => {
      const path = issue.path.length > 0 ? issue.path.join(".") : "suggestion";
      return `${path}: ${issue.message}`;
    }) ?? ["Unsupported suggestion shape"];
    super(
      `Unsupported suggestion (${issues[0]}). Nothing was saved to the private draft.`,
    );
    this.name = "SourceMonitoringUnsupportedSuggestionError";
    this.issues = issues;
  }
}

const contactSchema = z
  .object({
    address: z.string().max(220),
    phone: z.string().max(40),
  })
  .strict();

const monitoringCatalogItemSchema = catalogItemSchema.extend({
  available: z.boolean().nullable(),
});

const monitoringCatalogSectionSchema = catalogSectionSchema.extend({
  items: z.array(monitoringCatalogItemSchema).max(40),
});

const monitoringLinkSchema = integrationSchema.extend({
  enabled: z.boolean(),
  venueId: z.string().max(120).nullable(),
});

export const menuSuggestionSchema = z
  .object({
    catalogSections: z.array(monitoringCatalogSectionSchema).min(1).max(16),
    translations: z.array(z.unknown()).max(8),
  })
  .strict();

export const linksSuggestionSchema = z
  .object({
    integrations: z.array(monitoringLinkSchema).max(12),
    translations: z.array(z.unknown()).max(8),
  })
  .strict();

export function buildSourceMonitoringDiff(input: {
  current: PersistableSiteDraft;
  proposed: PersistableSiteDraft;
  extracted: ExtractedSite;
  checkedLinks: Array<{
    originalUrl: string;
    finalUrl: string;
    status: number;
  }>;
  capturedAt: Date;
}): MonitoringSuggestionInput[] {
  const suggestions: MonitoringSuggestionInput[] = [];
  const contact = {
    address: input.proposed.address,
    phone: input.proposed.phone,
  };
  const currentContact = {
    address: input.current.address,
    phone: input.current.phone,
  };
  const contactEvidence = evidenceForValues(
    input.extracted,
    [contact.address, contact.phone],
    input.capturedAt,
  );
  if (
    !same(currentContact, contact) &&
    hasEvidenceForEveryValue(
      input.extracted.pageText,
      [contact.address, contact.phone],
    )
  ) {
    suggestions.push(
      suggestion("CONTACT", "contact", currentContact, contact, contactEvidence),
    );
  }

  const hoursEvidence = evidenceForValues(
    input.extracted,
    input.proposed.businessHours.flatMap((row) => [row.days, row.hours]),
    input.capturedAt,
  );
  if (
    !same(input.current.businessHours, input.proposed.businessHours) &&
    input.proposed.businessHours.length > 0 &&
    hasEvidenceForEveryValue(
      input.extracted.pageText,
      input.proposed.businessHours.flatMap((row) => [row.days, row.hours]),
    )
  ) {
    suggestions.push(
      suggestion(
        "HOURS",
        "businessHours",
        input.current.businessHours,
        input.proposed.businessHours,
        hoursEvidence,
      ),
    );
  }

  const proposedCatalog = losslessCatalogSections(
    input.current.catalogSections,
    input.proposed.catalogSections,
  );
  const proposedItemNames = proposedCatalog.flatMap((section) =>
    section.items.map((item) => item.name),
  );
  if (
    !same(input.current.catalogSections, proposedCatalog) &&
    proposedItemNames.length > 0 &&
    hasEvidenceForEveryValue(input.extracted.pageText, proposedItemNames)
  ) {
    suggestions.push(
      suggestion(
        "MENU",
        "catalogSections",
        {
          catalogSections: input.current.catalogSections,
          translations: input.current.translations,
        },
        {
          catalogSections: proposedCatalog,
          translations: structurallyCompatibleTranslations(
            input.current.translations,
            proposedCatalog,
          ),
        },
        evidenceForValues(
          input.extracted,
          proposedItemNames.slice(0, 8),
          input.capturedAt,
        ),
      ),
    );
  }

  const proposedLinks = mergeLinks(
    input.current.integrations,
    input.extracted.links,
    input.checkedLinks,
  );
  if (!same(input.current.integrations, proposedLinks)) {
    const digest = contentDigest(input.extracted.pageText);
    suggestions.push(
      suggestion(
        "LINKS",
        "integrations",
        {
          integrations: input.current.integrations,
          translations: input.current.translations,
        },
        {
          integrations: proposedLinks,
          translations: integrationCompatibleTranslations(
            input.current.translations,
            proposedLinks.map((link) => link.label),
          ),
        },
        proposedLinks.slice(0, 8).map((link) => ({
          url: input.extracted.sourceUrl ?? input.extracted.source,
          excerpt: `${link.label}: ${link.url}`.slice(0, 280),
          capturedAt: input.capturedAt.toISOString(),
          contentDigest: digest,
        })),
      ),
    );
  }
  return suggestions;
}

function structurallyCompatibleTranslations(
  translations: unknown[],
  sections: PersistableSiteDraft["catalogSections"],
) {
  return translations.filter((translation) => {
    if (!isRecord(translation) || !Array.isArray(translation.catalogSections)) {
      return false;
    }
    return (
      translation.catalogSections.length === sections.length &&
      translation.catalogSections.every((section, sectionIndex) => {
        if (!isRecord(section) || !Array.isArray(section.items)) return false;
        return section.items.length === sections[sectionIndex]?.items.length;
      })
    );
  });
}

function integrationCompatibleTranslations(
  translations: unknown[],
  labels: string[],
) {
  return translations.flatMap((translation) => {
    if (!isRecord(translation)) return [];
    const currentLabels = Array.isArray(translation.integrationLabels)
      ? translation.integrationLabels
      : [];
    return [
      {
        ...translation,
        integrationLabels: labels.map(
          (label, index) =>
            typeof currentLabels[index] === "string"
              ? currentLabels[index]
              : label,
        ),
      },
    ];
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function losslessCatalogSections(
  current: PersistableSiteDraft["catalogSections"],
  proposed: PersistableSiteDraft["catalogSections"],
): PersistableSiteDraft["catalogSections"] {
  return proposed.map((proposedSection) => {
    const currentSection = current.find(
      (section) => section.name === proposedSection.name,
    );
    return {
      ...proposedSection,
      items: proposedSection.items.map((proposedItem) => {
        const currentItem = currentSection?.items.find(
          (item) => item.name === proposedItem.name,
        );
        if (!currentItem) return proposedItem;
        return {
          ...proposedItem,
          available: currentItem.available,
          attributes: currentItem.attributes,
          imageUrl: currentItem.imageUrl,
          originalImageUrl: currentItem.originalImageUrl,
          imageProvenance: currentItem.imageProvenance,
        };
      }),
    };
  });
}

function mergeLinks(
  current: PersistableSiteDraft["integrations"],
  extracted: ExtractedSite["links"],
  checked: Array<{ originalUrl: string; finalUrl: string; status: number }>,
): PersistableSiteDraft["integrations"] {
  const health = new Map(checked.map((result) => [result.originalUrl, result]));
  const merged = current.map((link) => {
    const result = health.get(link.url);
    return result && result.status >= 200 && result.status < 400
      ? { ...link, url: result.finalUrl }
      : link;
  });
  for (const link of extracted) {
    if (
      !merged.some(
        (candidate) =>
          candidate.url === link.url ||
          (link.provider && candidate.provider === link.provider),
      )
    ) {
      merged.push({
        type: link.type,
        label: link.label,
        provider: link.provider,
        url: link.url,
        enabled: false,
        venueId: null,
      });
    }
  }
  return merged;
}

export function monitoringFieldValue(
  draft: PersistableSiteDraft,
  field: MonitoringField | "MENU" | "CONTACT" | "HOURS" | "LINKS",
) {
  if (field === "CONTACT") {
    return { address: draft.address, phone: draft.phone };
  }
  if (field === "HOURS") return draft.businessHours;
  if (field === "MENU") {
    return {
      catalogSections: draft.catalogSections,
      translations: draft.translations,
    };
  }
  return {
    integrations: draft.integrations,
    translations: draft.translations,
  };
}

export function parseSourceMonitoringSuggestionValue(
  field: MonitoringField | "MENU" | "CONTACT" | "HOURS" | "LINKS",
  value: unknown,
  current: PersistableSiteDraft,
  vertical: Vertical,
) {
  try {
    const parsed =
      field === "CONTACT"
        ? contactSchema.parse(value)
        : field === "HOURS"
          ? businessHoursSchema.parse(value)
          : field === "MENU"
            ? menuSuggestionSchema.parse(value)
            : linksSuggestionSchema.parse(value);
    resolveVerticalConfig(vertical).draftSchema.parse({
      ...current,
      ...(field === "CONTACT" ? parsed : {}),
      ...(field === "HOURS" ? { businessHours: parsed } : {}),
      ...(field === "MENU" ? parsed : {}),
      ...(field === "LINKS" ? parsed : {}),
    });
    return parsed;
  } catch (error) {
    if (error instanceof SourceMonitoringUnsupportedSuggestionError) {
      throw error;
    }
    throw new SourceMonitoringUnsupportedSuggestionError(
      error instanceof z.ZodError ? error : undefined,
    );
  }
}

function suggestion(
  field: MonitoringField,
  path: string,
  currentValue: unknown,
  suggestedValue: unknown,
  evidence: SourceEvidence[],
): MonitoringSuggestionInput {
  const serialized = JSON.stringify({ field, path, currentValue, suggestedValue });
  return {
    fingerprint: createHash("sha256").update(serialized).digest("hex"),
    field,
    path,
    currentValue: currentValue as Prisma.InputJsonValue,
    suggestedValue: suggestedValue as Prisma.InputJsonValue,
    evidence,
  };
}

function evidenceForValues(
  extracted: ExtractedSite,
  values: string[],
  capturedAt: Date,
): SourceEvidence[] {
  const digest = contentDigest(extracted.pageText);
  return values
    .filter(Boolean)
    .slice(0, 8)
    .map((value) => ({
      url: extracted.sourceUrl ?? extracted.source,
      excerpt: evidenceExcerpt(extracted.pageText, value),
      capturedAt: capturedAt.toISOString(),
      contentDigest: digest,
    }));
}

function evidenceExcerpt(text: string, value: string): string {
  const index = normalize(text).indexOf(normalize(value));
  if (index < 0) return value.slice(0, 280);
  return text.slice(Math.max(0, index - 80), index + value.length + 120).trim();
}

function hasEvidenceForEveryValue(text: string, values: string[]): boolean {
  const haystack = normalize(text);
  const meaningful = values.map(normalize).filter(Boolean);
  return (
    meaningful.length > 0 &&
    meaningful.every((value) => haystack.includes(value))
  );
}

function normalize(value: string): string {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

function contentDigest(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function same(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}
