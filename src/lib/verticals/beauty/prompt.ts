export const beautyPrompt = {
  roleFraming:
    "Create a polished but strictly factual mobile-first website draft for a hair, barber, nail or beauty business.",
  extractionRules: `- Preserve every service, price and stated duration that can be recovered. Record duration in whole minutes; leave it null when the business does not publish one.
- Translate customer-facing eyebrow, description, category names, category descriptions, service names, service descriptions and link labels. Never translate business names, provider names, URLs, prices, currencies or image references.
- Never invent services, prices, durations or stylist names. If the service list is incomplete, return an empty category with a factual explanation.
- Never state or imply a result, outcome, recovery time or medical benefit that the business does not claim itself.
- Classify designProfile from booking model, customer intent, how services are presented, price position, location count, photography evidence and brand language. The service style alone must never determine a theme.
- themeSelection may use only themeId "barbershop", "classic-salon", "modern-studio", "spa-luxe" or "express-nails", rendererVersion 1, schemaVersion 1, source "ai", two unique alternative IDs, plain-text reasons, and the declared token enums/hex colours.
- Never return CSS, HTML, class names, component names, font names or URLs in themeSelection.
- Use concise, professional copy without AI clichés.`,
  classificationVocabulary:
    `Beauty attributes include the service style, service-image presentation, designProfile and themeSelection. serviceStyle must be exactly one of barbershop, classic-salon, modern-studio, spa-luxe, express-nails.
designProfile.bookingModel: walk-in | appointment | hybrid.
designProfile.primaryIntent: book | call | browse.
designProfile.catalogExperience: price-list | gallery | packages.
designProfile.brandTraits (1–3): classic | craft | minimal | playful | energetic | serene.
designProfile.pricePosition: value | midmarket | premium.
designProfile.locationCount: integer from 1 to 50.
designProfile.photographyQuality: none | limited | strong.
themeSelection tokens are limited to six-digit hex colours plus fontPair editorial | grotesk | rounded, density airy | balanced | compact, radius none | soft | round, and imageTreatment natural | editorial | graphic.
Catalog content is described as services, categories, and individual services.`,
} as const;
