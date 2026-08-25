import type { ImageProvenance, PhotoUsage } from "@/generated/prisma/enums";

export type LibraryPhotoProjection = {
  originalUrl: string;
  enhancedUrl: string | null;
  provenance: ImageProvenance;
  reviewStatus: "PENDING" | "APPROVED" | "REJECTED";
  selectedUsage: PhotoUsage | null;
  selectedCatalogItemId: string | null;
  activeVariant: "ORIGINAL" | "ENHANCED";
  enhancedReviewStatus: "PENDING" | "APPROVED" | "REJECTED" | null;
};

export type ClientImageSlot = {
  url: string | null;
  originalUrl: string | null;
  provenance: "official" | "owner" | "permissioned-ugc" | null;
};

export type PhotoBindableDraft = {
  heroImageUrl: string | null;
  heroOriginalImageUrl?: string | null;
  heroImageProvenance?: "official" | "owner" | "permissioned-ugc" | null;
  galleryImages?: Array<{
    url: string;
    originalUrl: string;
    provenance: "official" | "owner" | "permissioned-ugc";
  }>;
  catalogSections: Array<{
    name: string;
    items: Array<{
      name: string;
      imageUrl: string | null;
      originalImageUrl?: string | null;
      imageProvenance?: "official" | "owner" | "permissioned-ugc" | null;
    }>;
  }>;
  attributes: Record<string, unknown>;
};

const emptySlot: ClientImageSlot = {
  url: null,
  originalUrl: null,
  provenance: null,
};

export function clientImageProvenance(
  value: ImageProvenance | string,
): "official" | "owner" | "permissioned-ugc" {
  return value.toLowerCase().replaceAll("_", "-") as
    | "official"
    | "owner"
    | "permissioned-ugc";
}

export function isLocalImportedImageUrl(
  value: string | null | undefined,
): boolean {
  return typeof value === "string" && /^\/(?!\/)[a-zA-Z0-9/_\-.]+$/.test(value);
}

export function libraryPhotoMatchesUrl(
  photo: Pick<LibraryPhotoProjection, "originalUrl" | "enhancedUrl">,
  url: string | null | undefined,
): boolean {
  return Boolean(url) && (photo.originalUrl === url || photo.enhancedUrl === url);
}

export function isArbitraryRemoteImageUrl(
  value: string | null | undefined,
  library: readonly Pick<
    LibraryPhotoProjection,
    "originalUrl" | "enhancedUrl"
  >[],
): boolean {
  if (!value || isLocalImportedImageUrl(value)) return false;
  return !library.some((photo) => libraryPhotoMatchesUrl(photo, value));
}

export function activeReviewedPhotoUrl(
  photo: Pick<
    LibraryPhotoProjection,
    | "activeVariant"
    | "enhancedReviewStatus"
    | "enhancedUrl"
    | "originalUrl"
  >,
): string {
  return photo.activeVariant === "ENHANCED" &&
    photo.enhancedReviewStatus === "APPROVED" &&
    photo.enhancedUrl
    ? photo.enhancedUrl
    : photo.originalUrl;
}

export function slotFromLibraryPhoto(
  photo: LibraryPhotoProjection,
): ClientImageSlot {
  return {
    url: activeReviewedPhotoUrl(photo),
    originalUrl: photo.originalUrl,
    provenance: clientImageProvenance(photo.provenance),
  };
}

export function approvedSelectedPhotos(
  library: readonly LibraryPhotoProjection[],
  usage: PhotoUsage,
): LibraryPhotoProjection[] {
  return library.filter(
    (photo) =>
      photo.selectedUsage === usage && photo.reviewStatus === "APPROVED",
  );
}

/**
 * Library selections always win. Caller-authored remote URLs and provenance
 * cannot enter a slot unless they match an approved tenant photo. Local
 * imported paths stay readable so they can be adopted without rewriting.
 */
export function bindImageSlot(
  submitted: ClientImageSlot,
  library: readonly LibraryPhotoProjection[],
  selected: LibraryPhotoProjection | null = null,
): ClientImageSlot {
  if (selected?.reviewStatus === "APPROVED") {
    return slotFromLibraryPhoto(selected);
  }
  const url = submitted.url;
  if (!url) return emptySlot;
  const adopted = library.find(
    (photo) =>
      photo.reviewStatus === "APPROVED" && libraryPhotoMatchesUrl(photo, url),
  );
  if (adopted) return slotFromLibraryPhoto(adopted);
  if (isLocalImportedImageUrl(url)) {
    return {
      url,
      originalUrl: isLocalImportedImageUrl(submitted.originalUrl)
        ? submitted.originalUrl
        : url,
      provenance: submitted.provenance,
    };
  }
  return emptySlot;
}

export function gallerySlotsFromLibrary(
  library: readonly LibraryPhotoProjection[],
): Array<{
  url: string;
  originalUrl: string;
  provenance: "official" | "owner" | "permissioned-ugc";
}> {
  return approvedSelectedPhotos(library, "GALLERY").flatMap((photo) => {
    const slot = slotFromLibraryPhoto(photo);
    return slot.url && slot.originalUrl && slot.provenance
      ? [
          {
            url: slot.url,
            originalUrl: slot.originalUrl,
            provenance: slot.provenance,
          },
        ]
      : [];
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function projectImageSlot(project: Record<string, unknown>): ClientImageSlot {
  return {
    url: typeof project.imageUrl === "string" ? project.imageUrl : null,
    originalUrl:
      typeof project.originalImageUrl === "string"
        ? project.originalImageUrl
        : null,
    provenance:
      project.imageProvenance === "official" ||
      project.imageProvenance === "owner" ||
      project.imageProvenance === "permissioned-ugc"
        ? project.imageProvenance
        : null,
  };
}

export function bindProjectImagesFromLibrary(
  attributes: Record<string, unknown>,
  library: readonly LibraryPhotoProjection[],
): Record<string, unknown> {
  if (!Array.isArray(attributes.projects)) return attributes;
  const gallery = approvedSelectedPhotos(library, "GALLERY");
  return {
    ...attributes,
    projects: attributes.projects.map((value, index) => {
      if (!isRecord(value)) return value;
      const slot = bindImageSlot(
        projectImageSlot(value),
        library,
        gallery[index] ?? null,
      );
      return {
        ...value,
        imageUrl: slot.url,
        originalImageUrl: slot.originalUrl,
        imageProvenance: slot.provenance,
      };
    }),
  };
}

/**
 * Replaces caller-authored hero, gallery, catalog, and project image fields
 * with the tenant photo-library projection before an owner save.
 */
export function bindOwnerDraftImagesToLibrary<TDraft extends PhotoBindableDraft>(
  draft: TDraft,
  library: readonly LibraryPhotoProjection[],
): TDraft {
  const hero = bindImageSlot(
    {
      url: draft.heroImageUrl,
      originalUrl: draft.heroOriginalImageUrl ?? null,
      provenance: draft.heroImageProvenance ?? null,
    },
    library,
    approvedSelectedPhotos(library, "HERO")[0] ?? null,
  );
  return {
    ...draft,
    heroImageUrl: hero.url,
    heroOriginalImageUrl: hero.originalUrl,
    heroImageProvenance: hero.provenance,
    galleryImages: gallerySlotsFromLibrary(library),
    catalogSections: draft.catalogSections.map((section) => ({
      ...section,
      items: section.items.map((item) => {
        const slot = bindImageSlot(
          {
            url: item.imageUrl,
            originalUrl: item.originalImageUrl ?? null,
            provenance: item.imageProvenance ?? null,
          },
          library,
        );
        return {
          ...item,
          imageUrl: slot.url,
          originalImageUrl: slot.originalUrl,
          imageProvenance: slot.provenance,
        };
      }),
    })),
    attributes: bindProjectImagesFromLibrary(draft.attributes, library),
  };
}

export function catalogItemHasUnselectedRemoteImage(input: {
  imageUrl: string | null;
  originalImageUrl?: string | null;
  imageProvenance?: string | null;
  selected: LibraryPhotoProjection | null;
}): boolean {
  const url = input.imageUrl;
  if (!url || isLocalImportedImageUrl(url)) return false;
  const selected = input.selected;
  if (!selected || selected.reviewStatus !== "APPROVED") return true;
  const slot = slotFromLibraryPhoto(selected);
  return (
    input.imageUrl !== slot.url ||
    (input.originalImageUrl ?? null) !== slot.originalUrl ||
    (input.imageProvenance ?? null) !== slot.provenance
  );
}

export function projectHasUnselectedRemoteImage(input: {
  imageUrl: unknown;
  originalImageUrl?: unknown;
  imageProvenance?: unknown;
  selected: LibraryPhotoProjection | null;
}): boolean {
  if (typeof input.imageUrl !== "string" || !input.imageUrl) return false;
  if (isLocalImportedImageUrl(input.imageUrl)) return false;
  return catalogItemHasUnselectedRemoteImage({
    imageUrl: input.imageUrl,
    originalImageUrl:
      typeof input.originalImageUrl === "string"
        ? input.originalImageUrl
        : null,
    imageProvenance:
      typeof input.imageProvenance === "string" ? input.imageProvenance : null,
    selected: input.selected,
  });
}
