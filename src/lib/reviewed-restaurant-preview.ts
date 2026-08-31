const RESTAURANT_RENDERER_VERSION = "restaurant-renderer-v1";

const RESTAURANT_THEME_IDS = new Set([
  "terroir-editorial",
  "counter-service",
  "after-dark",
  "neighborhood-table",
  "daylight-cafe",
  "family-feast",
  "vesper-room",
]);

type ReviewedRestaurantDraft = {
  slug?: unknown;
  name?: unknown;
  defaultLocale?: unknown;
  heroImageUrl?: unknown;
  logoUrl?: unknown;
  galleryImages?: unknown;
  translations?: unknown;
  catalogSections?: unknown;
  attributes?: unknown;
};

export type ReviewedRestaurantPreviewExpectation = {
  slug: string;
  name: string;
  themeId: string;
  rendererVersion: typeof RESTAURANT_RENDERER_VERSION;
  heroImageUrl: string;
  logoUrl: string;
  sourcePhotoCount: number;
};

/**
 * Closes the private Malta batch over the public restaurant contract before it
 * crosses the operator boundary. The API owns full Zod validation; this guard
 * owns the launch-specific mt/en, EUR, branding, photo and renderer promises.
 */
export function reviewedRestaurantPreviewExpectation(
  draft: ReviewedRestaurantDraft,
): ReviewedRestaurantPreviewExpectation {
  const slug = requiredString(draft.slug, "slug");
  const name = requiredString(draft.name, `${slug} name`);
  if (draft.defaultLocale !== "mt") {
    throw new Error(`${slug} must use mt as its default locale`);
  }
  if (
    !Array.isArray(draft.translations) ||
    !draft.translations.some(
      (translation) =>
        isRecord(translation) && translation.locale === "en",
    )
  ) {
    throw new Error(`${slug} must include an en translation`);
  }

  const heroImageUrl = requiredHttpsUrl(
    draft.heroImageUrl,
    `${slug} hero image`,
  );
  const logoUrl = requiredHttpsUrl(draft.logoUrl, `${slug} logo`);
  const galleryImages = Array.isArray(draft.galleryImages)
    ? draft.galleryImages
    : [];
  if (galleryImages.length < 2) {
    throw new Error(`${slug} must include at least two source photos`);
  }
  const gallerySourceUrls: string[] = [];
  for (const image of galleryImages) {
    if (!isRecord(image) || image.provenance !== "official") {
      throw new Error(`${slug} source photos must be official`);
    }
    requiredHttpsUrl(image.url, `${slug} gallery image`);
    gallerySourceUrls.push(
      requiredHttpsUrl(image.originalUrl, `${slug} original gallery image`),
    );
  }
  const sourcePhotoUrls = [heroImageUrl, ...gallerySourceUrls];
  if (new Set(sourcePhotoUrls).size !== sourcePhotoUrls.length) {
    throw new Error(`${slug} must use a different source photo for each slot`);
  }

  const themeSelection = isRecord(draft.attributes)
    ? draft.attributes.themeSelection
    : null;
  if (!isRecord(themeSelection)) {
    throw new Error(`${slug} must use the scored restaurant theme registry`);
  }
  const themeId = requiredString(themeSelection.themeId, `${slug} theme`);
  if (
    !RESTAURANT_THEME_IDS.has(themeId) ||
    themeSelection.rendererVersion !== 1 ||
    themeSelection.schemaVersion !== 1 ||
    themeSelection.source !== "deterministic"
  ) {
    throw new Error(`${slug} has an invalid restaurant theme selection`);
  }

  if (!Array.isArray(draft.catalogSections) || draft.catalogSections.length === 0) {
    throw new Error(`${slug} must include a sourced menu`);
  }
  for (const section of draft.catalogSections) {
    if (!isRecord(section) || !Array.isArray(section.items)) {
      throw new Error(`${slug} has an invalid menu section`);
    }
    for (const item of section.items) {
      if (!isRecord(item) || item.currency !== "EUR") {
        throw new Error(`${slug} menu items must use EUR`);
      }
    }
  }

  return {
    slug,
    name,
    themeId,
    rendererVersion: RESTAURANT_RENDERER_VERSION,
    heroImageUrl,
    logoUrl,
    sourcePhotoCount: sourcePhotoUrls.length,
  };
}

export function verifyReviewedRestaurantPreview(
  html: string,
  expectation: ReviewedRestaurantPreviewExpectation,
): void {
  const expectedAttributes = [
    `data-site-theme="${expectation.themeId}"`,
    `data-site-theme-version="${expectation.rendererVersion}"`,
  ];
  if (expectedAttributes.some((attribute) => !html.includes(attribute))) {
    throw new Error(
      `${expectation.slug} did not render its scored restaurant theme`,
    );
  }
  if (!html.includes(expectation.heroImageUrl)) {
    throw new Error(`${expectation.slug} did not render its source hero photo`);
  }
  if (!html.includes(expectation.logoUrl)) {
    throw new Error(`${expectation.slug} did not render its restaurant logo`);
  }
  if (!html.includes("data-site-photo-gallery")) {
    throw new Error(`${expectation.slug} did not render its source photo gallery`);
  }
  if (!html.includes(expectation.name)) {
    throw new Error(`${expectation.slug} did not render its restaurant brand`);
  }
}

function requiredString(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${label} is required`);
  }
  return value.trim();
}

function requiredHttpsUrl(value: unknown, label: string): string {
  const raw = requiredString(value, label);
  const url = new URL(raw);
  if (url.protocol !== "https:") throw new Error(`${label} must use HTTPS`);
  return url.toString();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
