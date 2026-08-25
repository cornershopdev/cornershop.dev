import { describe, expect, it } from "bun:test";
import { FACTORY_BRAND } from "@/lib/brand";
import {
  signInErrorMessage,
  signInSurface,
} from "@/lib/sign-in-surface";
import { beautyMarketing } from "@/lib/verticals/beauty/marketing";
import { restaurantMarketing } from "@/lib/verticals/restaurant/marketing";

describe("sign-in surface", () => {
  it("keeps Cornershopdev neutral and factory-themed", () => {
    expect(signInSurface(null)).toMatchObject({
      brand: FACTORY_BRAND,
      inverse: true,
      copy: {
        title: "Open your workspace.",
        emailPlaceholder: "you@business.com",
        createLabel: "Build a local-business site",
        createHref: "/create",
      },
    });
  });

  it("uses restaurant language only on the restaurant storefront", () => {
    expect(signInSurface(restaurantMarketing)).toMatchObject({
      brand: restaurantMarketing.brand,
      inverse: false,
      copy: {
        title: "Open your restaurant.",
        emailPlaceholder: "owner@restaurant.com",
        createHref: "/create?vertical=restaurant",
      },
    });
  });

  it("lets the next niche own its future workspace language", () => {
    expect(signInSurface(beautyMarketing)).toMatchObject({
      brand: beautyMarketing.brand,
      inverse: false,
      copy: {
        title: "Open your salon preview.",
        emailPlaceholder: "owner@salon.com",
        createHref: "/create?vertical=beauty",
      },
    });
  });
});

describe("sign-in error states", () => {
  it("explains one-time invalid links without exposing account state", () => {
    expect(signInErrorMessage("INVALID_TOKEN")).toContain(
      "invalid, expired, or already used",
    );
    expect(signInErrorMessage("invalid-link")).toContain("Request a new one");
  });

  it("keeps unknown authentication failures generic", () => {
    expect(signInErrorMessage("unexpected")).toBe(
      "Sign-in could not be completed. Request a new secure link below.",
    );
    expect(signInErrorMessage(undefined)).toBeNull();
  });
});
