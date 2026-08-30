import { describe, expect, test } from "bun:test";

import { MOTION_PRESETS } from "@/components/motion";
import {
  designReferenceIdSchema,
  designReferenceSchema,
  designReferenceVerticalSchema,
  type DesignReferenceVertical,
} from "@/lib/site-themes/reference/contracts";
import {
  findDesignReference,
  getDesignReference,
  listDesignReferences,
  listDesignReferencesForVertical,
} from "@/lib/site-themes/reference/registry";
import {
  colorContrast,
  MIN_TEXT_CONTRAST,
} from "@/lib/site-themes/shared/color";

const references = listDesignReferences();

describe("design reference registry", () => {
  test("registers every declared reference exactly once", () => {
    const ids = references.map((reference) => reference.id);
    expect(ids).toEqual(designReferenceIdSchema.options);
    expect(new Set(ids).size).toBe(ids.length);
    expect(references).toHaveLength(15);
  });

  test("every entry satisfies the published contract", () => {
    for (const reference of references) {
      expect(() => designReferenceSchema.parse(reference)).not.toThrow();
    }
  });

  test("exposes both marketplaces so the library is not single-sourced", () => {
    const marketplaces = new Set(
      references.map((reference) => reference.marketplace),
    );
    expect(marketplaces).toEqual(new Set(["themeforest", "shopify"]));
  });
});

describe("design reference palettes", () => {
  /**
   * The reference palette shape mirrors `ThemeColorSurface`, so the same
   * accessibility floor that guards shipped themes guards the library a theme
   * author copies a palette out of.
   */
  const pairs = [
    { label: "background/foreground", left: "background", right: "foreground" },
    { label: "surface/foreground", left: "surface", right: "foreground" },
    {
      label: "accent/accentForeground",
      left: "accent",
      right: "accentForeground",
    },
  ] as const;

  for (const reference of references) {
    for (const pair of pairs) {
      test(`${reference.id} clears AA on ${pair.label}`, () => {
        const ratio = colorContrast(
          reference.palette[pair.left],
          reference.palette[pair.right],
        );
        expect(ratio).toBeGreaterThanOrEqual(MIN_TEXT_CONTRAST);
      });
    }
  }
});

describe("design reference motion register", () => {
  test("every shipped motion preset is exercised by at least one reference", () => {
    const used = new Set(
      references.map((reference) => reference.motionSignature.preset),
    );
    for (const preset of MOTION_PRESETS) {
      expect(used).toContain(preset);
    }
  });

  test("motion durations stay inside the primitive bounds", () => {
    for (const reference of references) {
      expect(reference.motionSignature.durationMs).toBeGreaterThanOrEqual(80);
      expect(reference.motionSignature.durationMs).toBeLessThanOrEqual(40_000);
    }
  });
});

describe("design reference lookup", () => {
  test("resolves a known reference by id", () => {
    expect(getDesignReference("rosa-2").name).toBe("Rosa 2");
    expect(findDesignReference("shopify-dawn")?.marketplace).toBe("shopify");
  });

  test("throws on an unregistered id rather than returning a partial", () => {
    expect(() =>
      getDesignReference("not-a-reference" as never),
    ).toThrow(/Unknown design reference/);
  });

  test("covers every vertical the factory builds for", () => {
    for (const vertical of designReferenceVerticalSchema
      .options as readonly DesignReferenceVertical[]) {
      expect(
        listDesignReferencesForVertical(vertical).length,
      ).toBeGreaterThanOrEqual(2);
    }
  });
});
