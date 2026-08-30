import {
  designReferenceSchema,
  type DesignReference,
  type DesignReferenceId,
  type DesignReferenceVertical,
} from "@/lib/site-themes/reference/contracts";

/**
 * The design reference library.
 *
 * Fifteen highly reviewed commercial storefront themes, reduced to the four
 * things that actually transfer: palette, type pairing, layout rhythm and
 * motion register. Palettes were extracted programmatically from marketplace
 * demo captures and then hand-tuned until every entry clears WCAG AA — colour
 * values are facts, not expression, and the tuned result is our own.
 *
 * Nothing else is taken. No markup, no stylesheet, no asset, no copy. These
 * entries never appear in customer-facing UI; the browsing route is
 * factory-internal and noindex. See `DESIGN.md`.
 */
const DESIGN_REFERENCES: readonly DesignReference[] = [
  {
    id: "rosa-2",
    name: "Rosa 2",
    marketplace: "themeforest",
    attribution: "ThemeForest Rosa 2 (restaurant, WordPress)",
    summary:
      "Dark editorial hospitality: a near-black paper with warm gold accents and enormous serif display type carrying the whole page.",
    palette: {
      background: "#0f1216",
      foreground: "#f4efe7",
      surface: "#171b21",
      accent: "#c8a56a",
      accentForeground: "#14110c",
    },
    typePairing: {
      register: "editorial",
      display: "High-contrast serif at display scale, tight negative tracking",
      body: "Neutral grotesk at generous line height for menu and hours",
    },
    layoutRhythm: {
      density: "airy",
      imageTreatment: "cinematic",
      note: "Full-bleed hero, then wide single-column editorial blocks with 96px+ section gaps.",
    },
    motionSignature: {
      preset: "ken-burns",
      durationMs: 24_000,
      note: "Slow hero drift under fixed type; nothing else moves above the fold.",
    },
    fitSignals: {
      verticals: ["restaurant"],
      pricePositions: ["premium"],
      photographyQualities: ["strong"],
    },
    takeaway:
      "Gold-on-near-black is the cheapest way to read premium without paid photography — provided the display serif is big enough to carry it.",
  },
  {
    id: "osteria",
    name: "Osteria",
    marketplace: "themeforest",
    attribution: "ThemeForest Osteria (restaurant, WordPress)",
    summary:
      "Bright paper with cool slate accents; menu presented as a typeset document rather than a product grid.",
    palette: {
      background: "#fdfcfa",
      foreground: "#131314",
      surface: "#eef0f3",
      accent: "#4e5c79",
      accentForeground: "#ffffff",
    },
    typePairing: {
      register: "editorial",
      display: "Old-style serif with small caps section labels",
      body: "Grotesk at 16/1.75 with a hard measure cap around 68 characters",
    },
    layoutRhythm: {
      density: "balanced",
      imageTreatment: "natural",
      note: "Two-column menu typeset with leader dots; imagery used as punctuation, never as the grid.",
    },
    motionSignature: {
      preset: "reveal",
      durationMs: 700,
      note: "Scroll-linked rise on each menu section; no hero animation at all.",
    },
    fitSignals: {
      verticals: ["restaurant"],
      pricePositions: ["midmarket", "premium"],
      photographyQualities: ["limited", "strong"],
    },
    takeaway:
      "A typeset menu beats a photo grid when the operator has no food photography worth showing.",
  },
  {
    id: "grand-restaurant",
    name: "Grand Restaurant",
    marketplace: "themeforest",
    attribution: "ThemeForest Grand Restaurant (multi-demo, WordPress)",
    summary:
      "Deep navy-black with a sand-gold accent; the reservation action is pinned and never scrolls out of reach.",
    palette: {
      background: "#0c1020",
      foreground: "#f3ece1",
      surface: "#14192c",
      accent: "#debb8b",
      accentForeground: "#1a1408",
    },
    typePairing: {
      register: "editorial",
      display: "Didone-adjacent serif, wide tracking on the eyebrow",
      body: "Humanist sans, slightly condensed for dense hour tables",
    },
    layoutRhythm: {
      density: "balanced",
      imageTreatment: "cinematic",
      note: "Alternating image/text bands at a fixed 50/50 split, each band exactly one viewport tall.",
    },
    motionSignature: {
      preset: "fade-in",
      durationMs: 520,
      note: "Short cross-fades between bands; deliberately understated so the pinned CTA stays dominant.",
    },
    fitSignals: {
      verticals: ["restaurant"],
      pricePositions: ["midmarket", "premium"],
      photographyQualities: ["limited", "strong"],
    },
    takeaway:
      "One persistent reservation control outperforms three scattered CTAs; the band rhythm is what makes room for it.",
  },
  {
    id: "piquant",
    name: "Piquant",
    marketplace: "themeforest",
    attribution: "ThemeForest Piquant (restaurant, WordPress)",
    summary:
      "Monochrome brutalist editorial: paper white against near-black, with rules instead of shadows.",
    palette: {
      background: "#fefefe",
      foreground: "#0c0c0c",
      surface: "#f5f5f3",
      accent: "#1c1c1c",
      accentForeground: "#fefefe",
    },
    typePairing: {
      register: "condensed",
      display: "Condensed grotesk at poster scale, all caps",
      body: "Same family at regular width — one typeface doing both jobs",
    },
    layoutRhythm: {
      density: "compact",
      imageTreatment: "graphic",
      note: "Hairline rules divide every section; zero rounded corners, zero elevation.",
    },
    motionSignature: {
      preset: "rise-in",
      durationMs: 620,
      note: "Short upward entrances that mimic type being set, not content flying in.",
    },
    fitSignals: {
      verticals: ["restaurant", "food-retail"],
      pricePositions: ["value", "midmarket"],
      photographyQualities: ["none", "limited"],
    },
    takeaway:
      "A single condensed family plus hairline rules produces a confident site with no photography at all.",
  },
  {
    id: "dine",
    name: "Dine",
    marketplace: "themeforest",
    attribution: "ThemeForest Dine (restaurant, WordPress)",
    summary:
      "Warm neutral daylight palette — taupe and oat on white — aimed at cafés and bakeries rather than dining rooms.",
    palette: {
      background: "#ffffff",
      foreground: "#34302c",
      surface: "#f3efe9",
      accent: "#64523b",
      accentForeground: "#ffffff",
    },
    typePairing: {
      register: "editorial",
      display: "Soft transitional serif, generous tracking",
      body: "Rounded-terminal sans for hours, allergens and pickup copy",
    },
    layoutRhythm: {
      density: "airy",
      imageTreatment: "natural",
      note: "Three-up card grid at a 4:5 crop; whitespace carries the premium read instead of contrast.",
    },
    motionSignature: {
      preset: "reveal",
      durationMs: 700,
      note: "Staggered card reveal on scroll, 90ms apart, so the grid resolves left to right.",
    },
    fitSignals: {
      verticals: ["restaurant", "food-retail", "beauty"],
      pricePositions: ["value", "midmarket"],
      photographyQualities: ["limited", "strong"],
    },
    takeaway:
      "Warm neutrals plus real whitespace read as expensive on amateur phone photography, where high contrast does not.",
  },
  {
    id: "sydney",
    name: "Sydney",
    marketplace: "themeforest",
    attribution: "ThemeForest Sydney (multipurpose business, WordPress)",
    summary:
      "Navy-and-white service business layout: credentials, service tiles, then a single quote request. Referenced for its slot order, not its look.",
    palette: {
      background: "#ffffff",
      foreground: "#15233e",
      surface: "#f4f5f7",
      accent: "#15233e",
      accentForeground: "#ffffff",
    },
    typePairing: {
      register: "grotesk",
      display: "Geometric sans, medium weight, no display serif anywhere",
      body: "Same family at 16/1.7 — trust reads as plainness here",
    },
    layoutRhythm: {
      density: "balanced",
      imageTreatment: "natural",
      note: "Hero, trust strip, three service tiles, proof, contact. The proof block always precedes the form.",
    },
    motionSignature: {
      preset: "fade-in",
      durationMs: 520,
      note: "Minimal motion by design; a service business that animates too much reads as an agency.",
    },
    fitSignals: {
      verticals: ["local-service"],
      pricePositions: ["value", "midmarket"],
      photographyQualities: ["none", "limited"],
    },
    takeaway:
      "The slot order is the asset: credentials before services, proof before the form. The visual register is replaceable.",
  },
  {
    id: "shopify-dawn",
    name: "Dawn",
    marketplace: "shopify",
    attribution: "Shopify Dawn (reference storefront theme)",
    summary:
      "The neutral baseline: system-adjacent type, slate accents, and nothing that competes with product imagery.",
    palette: {
      background: "#ffffff",
      foreground: "#1f2933",
      surface: "#f3f3f3",
      accent: "#54637d",
      accentForeground: "#ffffff",
    },
    typePairing: {
      register: "grotesk",
      display: "Neutral sans at moderate scale — no display face",
      body: "Same family; hierarchy comes from size and weight only",
    },
    layoutRhythm: {
      density: "balanced",
      imageTreatment: "natural",
      note: "Strict responsive product grid with square crops and a fixed 24px gutter.",
    },
    motionSignature: {
      preset: "fade-in",
      durationMs: 520,
      note: "Almost none. Motion is reserved for cart feedback.",
    },
    fitSignals: {
      verticals: ["food-retail", "local-service"],
      pricePositions: ["value", "midmarket"],
      photographyQualities: ["limited", "strong"],
    },
    takeaway:
      "The floor to beat. If an original theme is not clearly better than this, it is not worth registering.",
  },
  {
    id: "shopify-refresh",
    name: "Refresh",
    marketplace: "shopify",
    attribution: "Shopify Refresh (health & beauty storefront theme)",
    summary:
      "Cool clinical greys with a deep indigo accent; benefit claims sit above the product, not below it.",
    palette: {
      background: "#ffffff",
      foreground: "#0c1541",
      surface: "#edeef3",
      accent: "#0c1541",
      accentForeground: "#ffffff",
    },
    typePairing: {
      register: "grotesk",
      display: "Tight geometric sans, heavy weight for claims",
      body: "Neutral sans, small caps for ingredient and certification labels",
    },
    layoutRhythm: {
      density: "compact",
      imageTreatment: "graphic",
      note: "Benefit strip directly under the hero; specification tables treated as first-class content.",
    },
    motionSignature: {
      preset: "scale-in",
      durationMs: 560,
      note: "Subtle scale on benefit tiles so the claims register before the imagery.",
    },
    fitSignals: {
      verticals: ["beauty"],
      pricePositions: ["midmarket", "premium"],
      photographyQualities: ["limited", "strong"],
    },
    takeaway:
      "For beauty and wellness, the claim strip outranks the hero image. Cool greys keep it from reading as a sale.",
  },
  {
    id: "shopify-sense",
    name: "Sense",
    marketplace: "shopify",
    attribution: "Shopify Sense (health & beauty storefront theme)",
    summary:
      "Warm cream paper with a clay accent; soft, spa-adjacent, and built around ritual copy rather than product specs.",
    palette: {
      background: "#f9f7f2",
      foreground: "#33291f",
      surface: "#f5f3ed",
      accent: "#8f5b3a",
      accentForeground: "#ffffff",
    },
    typePairing: {
      register: "editorial",
      display: "Light serif with wide tracking, sentence case",
      body: "Humanist sans at 17/1.8 — long-form ritual and aftercare copy",
    },
    layoutRhythm: {
      density: "airy",
      imageTreatment: "natural",
      note: "Long single-column narrative broken by full-width tonal bands; booking sits at both ends.",
    },
    motionSignature: {
      preset: "reveal",
      durationMs: 700,
      note: "Slow scroll reveals matching the pacing of the copy.",
    },
    fitSignals: {
      verticals: ["beauty"],
      pricePositions: ["midmarket", "premium"],
      photographyQualities: ["limited", "strong"],
    },
    takeaway:
      "Cream and clay carry a treatment menu without any product photography — the copy pacing does the selling.",
  },
  {
    id: "shopify-local",
    name: "Local",
    marketplace: "shopify",
    attribution: "Shopify Local (food & drink storefront theme)",
    summary:
      "White paper, deep green accent, and store logistics — hours, pickup, delivery radius — treated as primary content.",
    palette: {
      background: "#ffffff",
      foreground: "#141414",
      surface: "#eeefec",
      accent: "#1a361a",
      accentForeground: "#ffffff",
    },
    typePairing: {
      register: "grotesk",
      display: "Sturdy grotesk, medium weight, minimal tracking",
      body: "Same family; numerals tabular so hour tables align",
    },
    layoutRhythm: {
      density: "compact",
      imageTreatment: "natural",
      note: "Logistics band pinned under the hero; category tiles below, product grid last.",
    },
    motionSignature: {
      preset: "rise-in",
      durationMs: 620,
      note: "Category tiles rise in sequence; the logistics band never animates.",
    },
    fitSignals: {
      verticals: ["food-retail", "restaurant"],
      pricePositions: ["value", "midmarket"],
      photographyQualities: ["none", "limited", "strong"],
    },
    takeaway:
      "For a shop, the hours-and-pickup band is the hero. Deep green keeps a grocery palette from reading as discount.",
  },
  {
    id: "shopify-craft",
    name: "Craft",
    marketplace: "shopify",
    attribution: "Shopify Craft (artisan storefront theme)",
    summary:
      "Paper-grey ground with a burnt-umber accent; maker provenance is the primary narrative.",
    palette: {
      background: "#f8f5f6",
      foreground: "#120b03",
      surface: "#eeecec",
      accent: "#6f4b2a",
      accentForeground: "#ffffff",
    },
    typePairing: {
      register: "editorial",
      display: "Slab-adjacent serif with visible texture at large sizes",
      body: "Neutral sans, small caps for provenance and origin labels",
    },
    layoutRhythm: {
      density: "balanced",
      imageTreatment: "natural",
      note: "Asymmetric two-column story blocks; the maker photo is always larger than the product.",
    },
    motionSignature: {
      preset: "sheen",
      durationMs: 2_400,
      note: "A slow sheen across the featured product card only — one accent, never repeated.",
    },
    fitSignals: {
      verticals: ["food-retail", "restaurant"],
      pricePositions: ["midmarket", "premium"],
      photographyQualities: ["limited", "strong"],
    },
    takeaway:
      "Provenance copy plus one restrained highlight effect justifies a higher price than the photography alone would.",
  },
  {
    id: "shopify-symmetry",
    name: "Symmetry",
    marketplace: "shopify",
    attribution: "Shopify Symmetry (multi-category storefront theme)",
    summary:
      "White ground with a steel-blue accent, built for operators with many categories and uneven imagery.",
    palette: {
      background: "#ffffff",
      foreground: "#22201f",
      surface: "#f2f5f7",
      accent: "#447495",
      accentForeground: "#ffffff",
    },
    typePairing: {
      register: "grotesk",
      display: "Neutral sans, tight tracking at heading scale",
      body: "Same family; category labels in caps at 12/0.18em",
    },
    layoutRhythm: {
      density: "balanced",
      imageTreatment: "graphic",
      note: "Mosaic category grid with mixed tile sizes, so a weak photo can be given a small tile.",
    },
    motionSignature: {
      preset: "rise-in",
      durationMs: 620,
      note: "Staggered mosaic entrance; the stagger hides the unevenness of mixed imagery.",
    },
    fitSignals: {
      verticals: ["food-retail", "local-service"],
      pricePositions: ["value", "midmarket"],
      photographyQualities: ["limited"],
    },
    takeaway:
      "Mixed tile sizes are the answer to mixed photo quality — put the bad photo in the small tile.",
  },
  {
    id: "shopify-pipeline",
    name: "Pipeline",
    marketplace: "shopify",
    attribution: "Shopify Pipeline (lifestyle storefront theme)",
    summary:
      "Off-white ground with an olive-brown accent; heavy on lifestyle imagery and single-focus sections.",
    palette: {
      background: "#fefefe",
      foreground: "#1d140b",
      surface: "#f5f5f4",
      accent: "#4c432b",
      accentForeground: "#ffffff",
    },
    typePairing: {
      register: "condensed",
      display: "Condensed sans in caps, wide tracking",
      body: "Neutral sans at 16/1.7",
    },
    layoutRhythm: {
      density: "airy",
      imageTreatment: "cinematic",
      note: "One idea per full-width section; no section carries two competing actions.",
    },
    motionSignature: {
      preset: "fade-in",
      durationMs: 520,
      note: "Section-level cross-fade only — the full-bleed images do the work.",
    },
    fitSignals: {
      verticals: ["beauty", "food-retail"],
      pricePositions: ["midmarket", "premium"],
      photographyQualities: ["strong"],
    },
    takeaway:
      "One action per section is the discipline worth stealing; it only survives if the photography is genuinely strong.",
  },
  {
    id: "shopify-taste",
    name: "Taste",
    marketplace: "shopify",
    attribution: "Shopify Taste (food & drink storefront theme)",
    summary:
      "Near-white ground with a pale blue surface and deep marine accent; menu items presented as an ordered catalogue.",
    palette: {
      background: "#fcfcfc",
      foreground: "#030a13",
      surface: "#ddebf5",
      accent: "#14456b",
      accentForeground: "#ffffff",
    },
    typePairing: {
      register: "grotesk",
      display: "Neutral sans, heavy weight, short headlines",
      body: "Same family; prices tabular and right-aligned",
    },
    layoutRhythm: {
      density: "compact",
      imageTreatment: "natural",
      note: "Catalogue rows with a fixed thumbnail rail; ordering action repeats on every row.",
    },
    motionSignature: {
      preset: "reveal",
      durationMs: 700,
      note: "Row-level reveal on scroll, tight range so long catalogues do not feel animated.",
    },
    fitSignals: {
      verticals: ["restaurant", "food-retail"],
      pricePositions: ["value", "midmarket"],
      photographyQualities: ["limited", "strong"],
    },
    takeaway:
      "For an ordering-first operator, the row-with-thumbnail catalogue converts better than any hero.",
  },
  {
    id: "shopify-combine",
    name: "Combine",
    marketplace: "shopify",
    attribution: "Shopify Combine (multi-purpose storefront theme)",
    summary:
      "Paper white with warm grey accents; a modular section kit rather than a fixed look.",
    palette: {
      background: "#fefefe",
      foreground: "#0a0503",
      surface: "#ededed",
      accent: "#544d4a",
      accentForeground: "#ffffff",
    },
    typePairing: {
      register: "grotesk",
      display: "Neutral sans, large but low-contrast",
      body: "Same family at 16/1.75",
    },
    layoutRhythm: {
      density: "balanced",
      imageTreatment: "natural",
      note: "Interchangeable section blocks with a shared vertical rhythm, so order can change without redesign.",
    },
    motionSignature: {
      preset: "scale-in",
      durationMs: 560,
      note: "Uniform entrance on every block — identical motion is what makes the blocks feel like one system.",
    },
    fitSignals: {
      verticals: ["local-service", "beauty", "food-retail"],
      pricePositions: ["value", "midmarket", "premium"],
      photographyQualities: ["none", "limited", "strong"],
    },
    takeaway:
      "Uniform section motion is what lets a modular kit stay coherent when the operator reorders sections.",
  },
].map((entry) => designReferenceSchema.parse(entry));

export function listDesignReferences(): readonly DesignReference[] {
  return DESIGN_REFERENCES;
}

export function findDesignReference(
  id: DesignReferenceId,
): DesignReference | undefined {
  return DESIGN_REFERENCES.find((reference) => reference.id === id);
}

export function getDesignReference(id: DesignReferenceId): DesignReference {
  const reference = findDesignReference(id);
  if (!reference) {
    throw new Error(`Unknown design reference: ${id}`);
  }
  return reference;
}

export function listDesignReferencesForVertical(
  vertical: DesignReferenceVertical,
): readonly DesignReference[] {
  return DESIGN_REFERENCES.filter((reference) =>
    reference.fitSignals.verticals.includes(vertical),
  );
}
