import type { SiteDraftView, SiteIntegrationView } from "@/lib/site-draft";
import { resolveVerticalConfig } from "@/lib/verticals/registry";
import type { VerticalId } from "@/lib/verticals/types";

export const STOREFRONT_BLOG_HREF = "/blog";

const actionPriority = {
  booking: ["booking", "ordering"],
  ordering: ["ordering", "booking"],
  quote: ["quote", "contact", "booking", "ordering"],
  contact: ["contact", "quote", "booking", "ordering"],
} as const;

export type StorefrontBlogHrefInput = {
  isLiveSurface: boolean;
  hasPublishedArticles: boolean;
};

/**
 * Live renderer themes expose one Blog entry only when the attested published
 * version actually has published articles. Preview, unpublished, and
 * zero-article surfaces keep the href absent.
 */
export function storefrontBlogHref(
  input: StorefrontBlogHrefInput,
): string | null {
  if (!input.isLiveSurface || !input.hasPublishedArticles) return null;
  return STOREFRONT_BLOG_HREF;
}

/**
 * The same conversion-first integration the live renderer would put in the
 * header. Blog chrome must not invent a CTA the published snapshot does not
 * already carry.
 */
export function resolveStorefrontPrimaryAction(
  draft: SiteDraftView,
  vertical: VerticalId,
): SiteIntegrationView | null {
  const config = resolveVerticalConfig(vertical);
  const allowedTypes = new Set(config.integrationTypes);
  const integrations = draft.integrations.filter(
    (integration) =>
      integration.enabled && allowedTypes.has(integration.type),
  );
  const booking = integrations.find(
    (integration) => integration.type === "booking",
  );
  const ordering = integrations.find((integration) =>
    ["ordering", "delivery"].includes(integration.type),
  );
  const quote = integrations.find((integration) => integration.type === "quote");
  const contact = integrations.find(
    (integration) => integration.type === "contact",
  );
  const actions = { booking, ordering, quote, contact };
  const [primaryAction] = actionPriority[
    config.rendererCapabilities(draft.attributes).primaryAction
  ].flatMap((type) => (actions[type] ? [actions[type]] : []));
  return primaryAction ?? null;
}
