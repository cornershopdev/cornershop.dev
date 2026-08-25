import { describe, expect, it } from "bun:test";
import {
  buildLocalServiceJsonLd,
  serializeLocalServiceJsonLd,
} from "@/lib/local-service-json-ld";
import { sampleLocalServiceSiteDraft } from "@/lib/verticals/local-service/fixtures";

describe("local-service JSON-LD", () => {
  it("emits the narrow LocalBusiness subtype with services and service areas", () => {
    const jsonLd = buildLocalServiceJsonLd(sampleLocalServiceSiteDraft);
    expect(jsonLd).toMatchObject({
      "@context": "https://schema.org",
      "@type": "Electrician",
      name: "Harbour Electrical",
      telephone: "+356 7999 1122",
      openingHours: [
        "Mo-Fr 08:00-18:00",
        "Sa 08:00-13:00",
      ],
    });
    expect(jsonLd.areaServed?.map(({ name }) => name)).toEqual([
      "Valletta",
      "Floriana",
      "Three Cities",
    ]);
    expect(jsonLd.makesOffer?.map(({ itemOffered }) => itemOffered.name)).toEqual([
      "Fault finding and repairs",
      "Rewires and upgrades",
    ]);
    expect(jsonLd.potentialAction?.map(({ target }) => target)).toEqual([
      "https://wa.me/35679991122",
      "https://harbour-electrical.example/quote",
    ]);
  });

  it("omits display-only or malformed hours from structured data", () => {
    const jsonLd = buildLocalServiceJsonLd({
      ...sampleLocalServiceSiteDraft,
      businessHours: [
        { days: "Sur rendez-vous", hours: "Appelez-nous" },
        { days: "lundi–vendredi", hours: "8:00–17:30" },
      ],
    });

    expect(jsonLd.openingHours).toEqual(["Mo-Fr 08:00-17:30"]);
  });

  it("escapes tag openings before inserting JSON-LD into a script tag", () => {
    expect(
      serializeLocalServiceJsonLd({
        ...sampleLocalServiceSiteDraft,
        description: "Trusted <script>alert(1)</script>",
      }),
    ).not.toContain("<script>");
  });
});
