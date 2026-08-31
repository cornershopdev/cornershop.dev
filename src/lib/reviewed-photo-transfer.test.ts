import { describe, expect, it, mock } from "bun:test";
import {
  buildReviewedGoogleSitesPhotoTransfers,
  isGoogleSitesPhotoUrl,
  reviewedGoogleSitesPhotoUrls,
} from "@/lib/reviewed-photo-transfer";

const googleHero =
  "https://lh3.googleusercontent.com/sitesv/refreshed-hero-token=w1280";
const googleGallery =
  "https://lh3.googleusercontent.com/sitesv/refreshed-gallery-token=w16383";

describe("reviewed Google Sites photo transfer", () => {
  it("selects unique Google Sites hero and gallery originals only", () => {
    expect(
      reviewedGoogleSitesPhotoUrls([
        {
          heroImageUrl: googleHero,
          heroOriginalImageUrl: googleHero,
          logoUrl:
            "https://lh3.googleusercontent.com/sitesv/unselected-logo=w400",
          galleryImages: [
            { originalUrl: googleGallery },
            { originalUrl: googleGallery },
            { originalUrl: "https://restaurant.example/gallery.jpg" },
          ],
        },
      ]),
    ).toEqual([googleHero, googleGallery]);
    expect(isGoogleSitesPhotoUrl(googleHero)).toBe(true);
    expect(
      isGoogleSitesPhotoUrl("https://lh3.googleusercontent.com/not-sites/photo"),
    ).toBe(false);
  });

  it("serializes Studio-fetched bytes for the authenticated import", async () => {
    const fetchImage = mock(async () => ({
      data: Uint8Array.from([0x89, 0x50, 0x4e, 0x47]),
      mediaType: "image/png",
    }));

    const transfers = await buildReviewedGoogleSitesPhotoTransfers({
      drafts: [{ heroOriginalImageUrl: googleHero }],
      fetchImage,
    });

    expect(fetchImage).toHaveBeenCalledWith(googleHero);
    expect(transfers).toEqual([
      {
        sourceUrl: googleHero,
        mediaType: "image/png",
        dataBase64: "iVBORw==",
      },
    ]);
  });

  it("fails before API mutation when Studio cannot fetch a selected photo", async () => {
    await expect(
      buildReviewedGoogleSitesPhotoTransfers({
        drafts: [{ heroOriginalImageUrl: googleHero }],
        fetchImage: async () => {
          throw new Error("The source image returned HTTP 403");
        },
      }),
    ).rejects.toThrow("The source image returned HTTP 403");
  });
});
