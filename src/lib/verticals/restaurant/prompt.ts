export const restaurantPrompt = {
  roleFraming:
    "Create a polished but strictly factual mobile-first restaurant website draft.",
  extractionRules: `- Preserve every menu item and price that can be recovered.
- Translate customer-facing cuisine, eyebrow, description, menu names, menu descriptions, dietary labels and link labels. Never translate restaurant names, provider names, URLs, prices, currencies or image references.
- Never invent menu items. If menu data is incomplete, return an empty menu section with a factual explanation.
- Classify designProfile from service model, customer intent, menu structure, price position, location count, photography evidence and brand language. Cuisine alone must never determine a theme.
- themeSelection may use only themeId "terroir-editorial", "counter-service", "after-dark", "neighborhood-table", "daylight-cafe", "family-feast" or "vesper-room", rendererVersion 1, schemaVersion 1, source "ai", two unique alternative IDs, plain-text reasons, and the declared token enums/hex colours.
- Never return CSS, HTML, class names, component names, font names or URLs in themeSelection.
- Use concise, warm hospitality copy without AI clichés.`,
  classificationVocabulary:
    `Restaurant attributes include cuisine, menu-image presentation, designProfile and themeSelection.
designProfile.serviceModel: fine-dining | full-service | fast-casual | cafe-bakery | bar-nightlife | takeaway.
designProfile.primaryIntent: reserve | order | visit.
designProfile.menuExperience: editorial | catalog | commerce.
designProfile.brandTraits (1–3): classic | craft | minimal | playful | energetic | atmospheric.
designProfile.pricePosition: value | midmarket | premium.
designProfile.locationCount: integer from 1 to 50.
designProfile.photographyQuality: none | limited | strong.
themeSelection tokens are limited to six-digit hex colours plus fontPair editorial | grotesk | condensed, density airy | balanced | compact, radius none | soft | round, and imageTreatment natural | cinematic | graphic.
Catalog content is described as menus, sections, and dishes.`,
} as const;
