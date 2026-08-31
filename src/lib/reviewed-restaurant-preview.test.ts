import { describe, expect, it } from "bun:test";
import {
  reviewedRestaurantPreviewExpectation,
  verifyReviewedRestaurantPreview,
} from "@/lib/reviewed-restaurant-preview";

const reviewedDraft = {
  slug: "malta-table",
  name: "Malta Table",
  defaultLocale: "mt",
  heroImageUrl: "https://restaurant.example/hero.jpg",
  logoUrl: "https://restaurant.example/logo.svg",
  galleryImages: [
    {
      url: "https://restaurant.example/dining-room.jpg",
      originalUrl: "https://restaurant.example/dining-room.jpg",
      provenance: "official",
    },
    {
      url: "https://restaurant.example/dish.jpg",
      originalUrl: "https://restaurant.example/dish.jpg",
      provenance: "official",
    },
  ],
  attributes: {
    themeSelection: {
      schemaVersion: 1,
      rendererVersion: 1,
      themeId: "neighborhood-table",
      source: "deterministic",
    },
  },
  catalogSections: [
    {
      items: [{ name: "Aljotta", currency: "EUR" }],
    },
  ],
  translations: [{ locale: "en" }],
};

describe("reviewed restaurant preview verification", () => {
  it("locks a branded mt/en restaurant onto the scored registry", () => {
    expect(reviewedRestaurantPreviewExpectation(reviewedDraft)).toEqual({
      slug: "malta-table",
      name: "Malta Table",
      themeId: "neighborhood-table",
      rendererVersion: "restaurant-renderer-v1",
      heroImageUrl: "https://restaurant.example/hero.jpg",
      logoUrl: "https://restaurant.example/logo.svg",
      sourcePhotoCount: 3,
    });
  });

  it("rejects legacy, unbranded, monolingual and non-EUR drafts", () => {
    for (const draft of [
      { ...reviewedDraft, defaultLocale: "en" },
      { ...reviewedDraft, logoUrl: null },
      { ...reviewedDraft, galleryImages: reviewedDraft.galleryImages.slice(0, 1) },
      {
        ...reviewedDraft,
        galleryImages: [
          reviewedDraft.galleryImages[0],
          {
            ...reviewedDraft.galleryImages[1],
            url: reviewedDraft.heroImageUrl,
            originalUrl: reviewedDraft.heroImageUrl,
          },
        ],
      },
      { ...reviewedDraft, translations: [] },
      {
        ...reviewedDraft,
        attributes: { themeSelection: { themeId: "legacy-v1" } },
      },
      {
        ...reviewedDraft,
        catalogSections: [{ items: [{ name: "Aljotta", currency: "USD" }] }],
      },
    ]) {
      expect(() => reviewedRestaurantPreviewExpectation(draft)).toThrow();
    }
  });

  it("requires the public preview to render the selected theme and source hero", () => {
    const expectation = reviewedRestaurantPreviewExpectation(reviewedDraft);
    const html = `<main data-site-theme="neighborhood-table" data-site-theme-version="restaurant-renderer-v1" style="background-image:url(&quot;https://restaurant.example/hero.jpg&quot;)"><span style="background-image:url(&quot;https://restaurant.example/logo.svg&quot;)">Malta Table</span><section data-site-photo-gallery></section></main>`;

    expect(() => verifyReviewedRestaurantPreview(html, expectation)).not.toThrow();
    expect(() =>
      verifyReviewedRestaurantPreview(
        html.replace("restaurant-renderer-v1", "legacy-v1"),
        expectation,
      ),
    ).toThrow("did not render its scored restaurant theme");
    expect(() =>
      verifyReviewedRestaurantPreview(
        html.replace("https://restaurant.example/hero.jpg", ""),
        expectation,
      ),
    ).toThrow("did not render its source hero photo");
    expect(() =>
      verifyReviewedRestaurantPreview(
        html.replace("https://restaurant.example/logo.svg", ""),
        expectation,
      ),
    ).toThrow("did not render its restaurant logo");
    expect(() =>
      verifyReviewedRestaurantPreview(
        html.replace("data-site-photo-gallery", ""),
        expectation,
      ),
    ).toThrow("did not render its source photo gallery");
  });
});
