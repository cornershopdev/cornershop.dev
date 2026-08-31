export const MAX_REVIEWED_PHOTO_TRANSFER_BYTES = 12_000_000;
export const MAX_REVIEWED_PHOTO_TRANSFER_TOTAL_BYTES = 20_000_000;
export const MAX_REVIEWED_DRAFT_IMPORT_BODY_BYTES = 28_000_000;

export type ReviewedPhotoTransferPayload = {
  sourceUrl: string;
  mediaType: string;
  dataBase64: string;
};

type PublicImageFetcher = (url: string) => Promise<{
  data: Uint8Array;
  mediaType: string;
}>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isGoogleSitesPhotoUrl(rawUrl: string): boolean {
  try {
    const url = new URL(rawUrl);
    return (
      url.protocol === "https:" &&
      url.hostname === "lh3.googleusercontent.com" &&
      url.pathname.startsWith("/sitesv/")
    );
  } catch {
    return false;
  }
}

/**
 * Selects only the reviewed storefront slots. Logos, favicons, source evidence,
 * and unselected candidates stay out of the authenticated transfer payload.
 */
export function reviewedGoogleSitesPhotoUrls(
  drafts: readonly unknown[],
): string[] {
  const urls: string[] = [];
  for (const draft of drafts) {
    if (!isRecord(draft)) continue;
    const hero =
      typeof draft.heroOriginalImageUrl === "string"
        ? draft.heroOriginalImageUrl
        : typeof draft.heroImageUrl === "string"
          ? draft.heroImageUrl
          : null;
    if (hero && isGoogleSitesPhotoUrl(hero)) urls.push(hero);

    if (!Array.isArray(draft.galleryImages)) continue;
    for (const image of draft.galleryImages) {
      if (!isRecord(image) || typeof image.originalUrl !== "string") continue;
      if (isGoogleSitesPhotoUrl(image.originalUrl)) urls.push(image.originalUrl);
    }
  }
  return [...new Set(urls)];
}

export async function buildReviewedGoogleSitesPhotoTransfers(input: {
  drafts: readonly unknown[];
  fetchImage: PublicImageFetcher;
}): Promise<ReviewedPhotoTransferPayload[]> {
  const transfers: ReviewedPhotoTransferPayload[] = [];
  let totalBytes = 0;
  for (const sourceUrl of reviewedGoogleSitesPhotoUrls(input.drafts)) {
    const image = await input.fetchImage(sourceUrl);
    if (image.data.byteLength > MAX_REVIEWED_PHOTO_TRANSFER_BYTES) {
      throw new Error("A reviewed Google Sites photo is larger than 12 MB");
    }
    totalBytes += image.data.byteLength;
    if (totalBytes > MAX_REVIEWED_PHOTO_TRANSFER_TOTAL_BYTES) {
      throw new Error("Reviewed Google Sites photos are larger than 20 MB");
    }
    transfers.push({
      sourceUrl,
      mediaType: image.mediaType,
      dataBase64: Buffer.from(image.data).toString("base64"),
    });
  }
  return transfers;
}
