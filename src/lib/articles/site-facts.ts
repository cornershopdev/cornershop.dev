import type { VerticalId } from "@/lib/verticals/types";
import type { ArticleFactKey } from "@/lib/articles/topic-plans";
import type { ArticleIntegrationCapability } from "@/lib/articles/integration-capabilities";

/**
 * The slice of a published site snapshot the content engine may write about.
 * Everything here is factual site data; an article may reference only these
 * facts and never assert a claim (award, price, supplier) absent from them.
 */
export type SiteFacts = {
  slug: string;
  name: string;
  vertical: VerticalId;
  locale: string;
  address: string | null;
  phone: string | null;
  businessHours: Array<{ days: string; hours: string }>;
  catalogItems: Array<{
    id: string;
    name: string;
    price: number | null;
    currency: string;
  }>;
  integrationCapabilities: ArticleIntegrationCapability[];
};

export function availableFacts(facts: SiteFacts): Set<ArticleFactKey> {
  const available = new Set<ArticleFactKey>();
  if (facts.catalogItems.length > 0) available.add("catalogItems");
  if (facts.address?.trim()) available.add("address");
  if (
    facts.businessHours.some(
      (entry) => entry.days.trim() && entry.hours.trim(),
    )
  ) {
    available.add("businessHours");
  }
  if (facts.phone?.trim()) available.add("phone");
  return available;
}
