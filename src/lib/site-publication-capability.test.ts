import { describe, expect, it } from "bun:test";
import { Vertical } from "@/generated/prisma/enums";
import {
  assertVerticalPublicationEnabled,
  PUBLICATION_UNAVAILABLE_MESSAGE,
  publicationCapabilityFailureResponse,
  SitePublicationCapabilityError,
} from "@/lib/site-publication-capability";

const ownerReviewVerticals = [
  Vertical.RESTAURANT,
  Vertical.FOOD_RETAIL,
  Vertical.LOCAL_SERVICE,
] as const;

describe("site publication capability", () => {
  it("allows reviewed publication mutation for verticals with owner-review workflows", () => {
    for (const vertical of ownerReviewVerticals) {
      expect(publicationCapabilityFailureResponse(vertical)).toBeNull();
      expect(() => assertVerticalPublicationEnabled(vertical)).not.toThrow();
    }
  });

  it("fails closed for beauty owner publication mutation", async () => {
    const response = publicationCapabilityFailureResponse(Vertical.BEAUTY);
    expect(response).not.toBeNull();
    expect(response?.status).toBe(409);
    expect(await response?.json()).toEqual({
      error: PUBLICATION_UNAVAILABLE_MESSAGE,
    });
    expect(() => assertVerticalPublicationEnabled(Vertical.BEAUTY)).toThrow(
      SitePublicationCapabilityError,
    );
    expect(() => assertVerticalPublicationEnabled(Vertical.BEAUTY)).toThrow(
      PUBLICATION_UNAVAILABLE_MESSAGE,
    );
  });
});
