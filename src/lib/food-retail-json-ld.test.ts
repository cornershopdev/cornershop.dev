import { describe, expect, it } from "bun:test";
import { buildFoodRetailJsonLd } from "@/lib/food-retail-json-ld";
import { sampleFoodRetailDraft } from "@/lib/verticals/food-retail/fixtures";

describe("food retail JSON-LD", () => {
  it("emits a typed shop and only sourced product facts", () => {
    const jsonLd = buildFoodRetailJsonLd(sampleFoodRetailDraft);

    expect(jsonLd).toMatchObject({
      "@context": "https://schema.org",
      "@type": "Bakery",
      name: "Maison Levain",
      category: "Bakery",
      telephone: sampleFoodRetailDraft.phone,
      openingHours: ["Monday–Friday 07:00–16:00", "Saturday 08:00–14:00"],
      potentialAction: {
        "@type": "OrderAction",
        target: "https://maison-levain.example/order",
      },
    });
    expect(jsonLd).not.toHaveProperty("acceptsReservations");

    const products = jsonLd.hasOfferCatalog?.itemListElement.flatMap(
      (section) => section.itemListElement,
    );
    expect(products).toHaveLength(2);
    expect(products?.[0]).toMatchObject({
      price: 5.5,
      priceCurrency: "EUR",
      itemOffered: { "@type": "Product", name: "Country sourdough" },
    });
    expect(products?.[1]).not.toHaveProperty("price");
    expect(JSON.stringify(jsonLd)).not.toContain("allergens");
    expect(JSON.stringify(jsonLd)).not.toContain("gluten");
  });
});
