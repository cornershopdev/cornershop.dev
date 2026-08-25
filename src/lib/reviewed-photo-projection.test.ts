import { describe, expect, it } from "bun:test";
import type { LibraryPhotoProjection } from "@/lib/reviewed-photo-projection";
import {
  bindImageSlot,
  bindOwnerDraftImagesToLibrary,
  catalogItemHasUnselectedRemoteImage,
  gallerySlotsFromLibrary,
  isArbitraryRemoteImageUrl,
  projectHasUnselectedRemoteImage,
  slotFromLibraryPhoto,
} from "@/lib/reviewed-photo-projection";

function photo(
  overrides: Partial<LibraryPhotoProjection> &
    Pick<LibraryPhotoProjection, "originalUrl">,
): LibraryPhotoProjection {
  return {
    enhancedUrl: null,
    provenance: "OFFICIAL",
    reviewStatus: "APPROVED",
    selectedUsage: null,
    selectedCatalogItemId: null,
    activeVariant: "ORIGINAL",
    enhancedReviewStatus: null,
    ...overrides,
  };
}

const originalHero = "https://assets.example/original-hero.jpg";
const enhancedHero = "https://assets.example/enhanced-hero.webp";
const productOriginal = "https://assets.example/original-loaf.jpg";
const projectOriginal = "https://assets.example/original-rewire.jpg";
const arbitrary = "https://example.com/invented-product.jpg";

describe("reviewed photo slot mapping", () => {
  it("rejects arbitrary remote URLs that are not in the tenant library", () => {
    expect(isArbitraryRemoteImageUrl(arbitrary, [])).toBe(true);
    expect(
      isArbitraryRemoteImageUrl(arbitrary, [photo({ originalUrl: originalHero })]),
    ).toBe(true);
    expect(
      isArbitraryRemoteImageUrl(originalHero, [
        photo({ originalUrl: originalHero }),
      ]),
    ).toBe(false);
    expect(isArbitraryRemoteImageUrl("/approved/loaf.webp", [])).toBe(false);
  });

  it("maps approved originals and derivatives onto hero, catalog, gallery, and project slots", () => {
    const hero = photo({
      originalUrl: originalHero,
      enhancedUrl: enhancedHero,
      selectedUsage: "HERO",
      activeVariant: "ENHANCED",
      enhancedReviewStatus: "APPROVED",
      provenance: "OWNER",
    });
    const product = photo({
      originalUrl: productOriginal,
      selectedUsage: "CATALOG",
      selectedCatalogItemId: "item_bread",
      provenance: "OFFICIAL",
    });
    const gallery = photo({
      originalUrl: projectOriginal,
      selectedUsage: "GALLERY",
      provenance: "PERMISSIONED_UGC",
    });
    const bound = bindOwnerDraftImagesToLibrary(
      {
        heroImageUrl: arbitrary,
        heroOriginalImageUrl: arbitrary,
        heroImageProvenance: "owner",
        galleryImages: [
          {
            url: arbitrary,
            originalUrl: arbitrary,
            provenance: "owner",
          },
        ],
        catalogSections: [
          {
            name: "Breads",
            items: [
              {
                name: "Country loaf",
                imageUrl: arbitrary,
                originalImageUrl: arbitrary,
                imageProvenance: "owner",
              },
            ],
          },
        ],
        attributes: {
          projects: [
            {
              title: "Townhouse rewire",
              imageUrl: arbitrary,
              originalImageUrl: arbitrary,
              imageProvenance: "owner",
              location: "Valletta",
            },
          ],
        },
      },
      [hero, product, gallery],
    );

    expect(bound.heroImageUrl).toBe(enhancedHero);
    expect(bound.heroOriginalImageUrl).toBe(originalHero);
    expect(bound.heroImageProvenance).toBe("owner");
    expect(bound.galleryImages).toMatchObject([
      {
        url: projectOriginal,
        originalUrl: projectOriginal,
        provenance: "permissioned-ugc",
      },
    ]);
    expect(bound.catalogSections[0]?.items[0]).toMatchObject({
      imageUrl: null,
      originalImageUrl: null,
      imageProvenance: null,
    });
    expect(bound.attributes.projects).toMatchObject([
      {
        title: "Townhouse rewire",
        imageUrl: projectOriginal,
        originalImageUrl: projectOriginal,
        imageProvenance: "permissioned-ugc",
        location: "Valletta",
      },
    ]);
    expect(gallerySlotsFromLibrary([hero, product, gallery])).toEqual([
      {
        url: projectOriginal,
        originalUrl: projectOriginal,
        provenance: "permissioned-ugc",
      },
    ]);
  });

  it("adopts an approved library original without rewriting its stored URL or provenance", () => {
    const loaf = photo({
      originalUrl: productOriginal,
      provenance: "OFFICIAL",
    });
    expect(
      bindImageSlot(
        {
          url: productOriginal,
          originalUrl: arbitrary,
          provenance: "owner",
        },
        [loaf],
      ),
    ).toEqual(slotFromLibraryPhoto(loaf));
  });

  it("keeps existing valid local imported images readable", () => {
    expect(
      bindImageSlot(
        {
          url: "/approved/loaf.webp",
          originalUrl: "/approved/loaf.webp",
          provenance: "owner",
        },
        [],
      ),
    ).toEqual({
      url: "/approved/loaf.webp",
      originalUrl: "/approved/loaf.webp",
      provenance: "owner",
    });
  });

  it("does not persist caller-authored provenance for a remote URL outside the library", () => {
    expect(
      bindImageSlot(
        {
          url: arbitrary,
          originalUrl: arbitrary,
          provenance: "permissioned-ugc",
        },
        [photo({ originalUrl: originalHero })],
      ),
    ).toEqual({
      url: null,
      originalUrl: null,
      provenance: null,
    });
  });

  it("flags unselected remote catalog and project images as unpublished", () => {
    const selected = photo({
      originalUrl: productOriginal,
      selectedUsage: "CATALOG",
      selectedCatalogItemId: "item_bread",
    });
    expect(
      catalogItemHasUnselectedRemoteImage({
        imageUrl: productOriginal,
        originalImageUrl: productOriginal,
        imageProvenance: "official",
        selected,
      }),
    ).toBe(false);
    expect(
      catalogItemHasUnselectedRemoteImage({
        imageUrl: arbitrary,
        originalImageUrl: arbitrary,
        imageProvenance: "owner",
        selected: null,
      }),
    ).toBe(true);
    expect(
      catalogItemHasUnselectedRemoteImage({
        imageUrl: "/approved/loaf.webp",
        selected: null,
      }),
    ).toBe(false);
    expect(
      projectHasUnselectedRemoteImage({
        imageUrl: projectOriginal,
        originalImageUrl: projectOriginal,
        imageProvenance: "official",
        selected: photo({
          originalUrl: projectOriginal,
          selectedUsage: "GALLERY",
        }),
      }),
    ).toBe(false);
    expect(
      projectHasUnselectedRemoteImage({
        imageUrl: arbitrary,
        selected: null,
      }),
    ).toBe(true);
  });
});
