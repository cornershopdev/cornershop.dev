export const foodRetailPrompt = {
  roleFraming:
    "Create a polished but strictly factual mobile-first storefront draft for an independent bakery, patisserie, butcher, deli, cheesemonger, grocer or similar local food shop. This is retail, not a full-service restaurant.",
  extractionRules: `- Preserve every product, range, category and price that can be recovered. Keep price null when none is published.
- Translate customer-facing eyebrow, description, pickup details, category names, product names, product descriptions, seasonal availability, preorder notes and link labels. Preserve allergen entries exactly as sourced; the renderer localizes only their surrounding label. Never translate business names, provider names, URLs, prices, currencies or image references.
- Never invent products, prices, stock, seasonal availability, preorder requirements, pickup options or allergens. A product appearing in a range does not prove current stock: use available null and stockSourceUrl null unless the source explicitly states in-stock or out-of-stock status. If it does, preserve that boolean availability and set stockSourceUrl to the exact evidence page URL. The visible attribute only controls storefront inclusion and defaults true. If a product range is incomplete, return an empty category with a factual explanation.
- Allergens may be returned only when the source explicitly states them. Every non-empty allergens array must carry allergenSourceUrl set to the exact source page URL; otherwise use [] and null.
- Set preorderRequired only when the source explicitly says a product must or need not be preordered. Otherwise use null. Preserve existing preorder, click-and-collect, ordering and delivery links as external links.
- Do not create booking links, table reservations, restaurant seating, dining-room language or reservation availability.
- Classify shopType only from explicit business evidence. Use local-food-shop when the subtype is uncertain.
- Classify designProfile from how the shop is served, what a customer comes to do, how the range is presented, price position, location count, photography evidence and how fast the published range goes stale. The shop type alone must never determine a theme.
- themeSelection may use only themeId "daily-counter", "craft-counter" or "market-shelves", rendererVersion 1, schemaVersion 1, source "ai", two unique alternative IDs, plain-text reasons, and the declared token enums/hex colours.
- Never return CSS, HTML, class names, component names, font names or URLs in themeSelection.
- Use concise retail copy focused on choosing products, checking hours, finding the shop and placing an existing preorder without AI clichés.`,
  classificationVocabulary:
    `Food retail attributes include shopType, product-image presentation, sourced pickup details, designProfile and themeSelection. shopType must be exactly one of bakery, patisserie, butcher, deli, cheesemonger, grocer, local-food-shop.
designProfile.fulfillmentModel: counter | click-collect | delivery.
designProfile.primaryIntent: visit | order | browse.
designProfile.catalogExperience: daily-list | showcase | aisles.
designProfile.brandTraits (1–3): classic | craft | minimal | warm | rustic | modern.
designProfile.pricePosition: value | midmarket | premium.
designProfile.locationCount: integer from 1 to 50.
designProfile.photographyQuality: none | limited | strong.
designProfile.rangeVolatility: daily | seasonal | stable.
themeSelection tokens are limited to six-digit hex colours plus fontPair editorial | grotesk | rounded, density airy | balanced | compact, radius none | soft | round, and imageTreatment natural | editorial | graphic.
Catalog content is described as product ranges, categories and products, never restaurant menus, dishes or reservations.`,
} as const;
