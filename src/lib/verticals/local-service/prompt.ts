export const localServicePrompt = {
  roleFraming:
    "Create a factual, conversion-focused mobile-first website draft for a local trade or artisan business.",
  extractionRules: `- Recover only services the business explicitly offers. Never turn generic page language into a service.
- Classify tradeType using the closed vocabulary. Use general-trades when the evidence does not support a narrower trade.
- Record service areas only when explicitly named. Do not infer a radius, town, region or travel distance from the address.
- Record emergency or availability posture only when the source states it. Use not-stated otherwise; never imply immediate response.
- Record credentials, licence references, memberships, insurance posture and trust signals exactly as stated. Never infer that a trade is licensed, certified, vetted, insured or guaranteed.
- Projects must describe real work present in the source. Keep project images tied to their source; never invent before/after claims.
- Preserve phone, WhatsApp, quote, marketplace, scheduling and social links as external tools. Never invent a WhatsApp number or quote destination.
- Prices may be fixed, from, hourly, quote-only or unstated. Preserve the stated model and unit; never convert quote-only work into a price.
- themeSelection may use only themeId "direct-response", "trusted-local" or "project-led", rendererVersion 1, schemaVersion 1, source "ai", two unique alternative IDs, plain-text reasons, and the declared token enums/hex colours.
- Never return CSS, HTML, class names, component names, font names or URLs in themeSelection.
- Translate customer-facing hero, service category, service and integration-label copy. Keep business names, place names, credentials, URLs, phone numbers and prices unchanged.
- Use direct local-service copy. Avoid restaurant language, appointment assumptions, unsupported guarantees and AI clichés.`,
  classificationVocabulary:
    "tradeType must be plumber, electrician, builder, repair, artisan, or general-trades. availabilityPosture must be not-stated, scheduled, same-day, emergency-callout, 24-7-emergency, or by-appointment. Service pricingModel must be not-stated, fixed, from, hourly, or quote. External link types may be quote, contact, booking, or social; WhatsApp is contact, not social or booking. themeSelection tokens are limited to six-digit hex colours plus fontPair grotesk | condensed | editorial, density airy | balanced | compact, radius none | soft | round, and imageTreatment natural | documentary | graphic.",
} as const;
