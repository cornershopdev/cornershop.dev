import type { ArticleIntegrationCapability } from "@/lib/articles/integration-capabilities";
import type { VerticalId } from "@/lib/verticals/types";

/**
 * A topic plan names a reusable angle an article can take for a site. The key
 * is stable across sites and batches so the dedupe pass can tell "the same
 * slot refilled" from "a new angle"; the title is the repository-owned topic
 * label; `requiredFacts` names site data the article may
 * only exist if the site actually carries — a neighbourhood guide with no
 * address is exactly the generic filler this engine exists to prevent.
 */
export type ArticleTopicPlan = {
  key: ArticleTopicKey;
  title: string;
  requiredFacts: ArticleFactKey[];
  requiredAnyIntegrationCapabilities?: ArticleIntegrationCapability[];
  templateKey: ArticleTemplateKey;
  catalogItem: "required" | "forbidden";
};

export const ARTICLE_TOPIC_KEYS = [
  "seasonal-menu",
  "neighbourhood-guide",
  "private-events",
  "dietary-faqs",
  "chef-story",
  "treatment-explainers",
  "aftercare",
  "trends",
  "first-visit",
  "service-walkthrough",
  "coverage-area",
  "quote-guide",
  "sourcing-story",
  "seasonal-stock",
  "ordering-options",
] as const;

export type ArticleTopicKey = (typeof ARTICLE_TOPIC_KEYS)[number];

export const ARTICLE_TEMPLATE_KEYS = [
  "restaurant-current-menu",
  "restaurant-location",
  "restaurant-group-enquiry",
  "restaurant-dietary-enquiry",
  "restaurant-menu-facts",
  "beauty-treatment-listing",
  "beauty-aftercare-enquiry",
  "beauty-current-listing",
  "beauty-visit-planning",
  "service-current-listing",
  "service-location",
  "service-quote-enquiry",
  "retail-listing-facts",
  "retail-current-stock",
  "retail-ordering-options",
] as const;

export type ArticleTemplateKey = (typeof ARTICLE_TEMPLATE_KEYS)[number];

/**
 * The site facts a topic may draw on. Each maps to a field the composer
 * extracts from the live draft snapshot; a topic whose facts are all absent
 * can never be selected.
 */
export type ArticleFactKey =
  | "catalogItems"
  | "address"
  | "businessHours"
  | "phone";

const RESTAURANT_TOPICS: ArticleTopicPlan[] = [
  {
    key: "seasonal-menu",
    title: "A current menu listing",
    requiredFacts: ["catalogItems"],
    templateKey: "restaurant-current-menu",
    catalogItem: "required",
  },
  {
    key: "neighbourhood-guide",
    title: "How to find us",
    requiredFacts: ["address"],
    templateKey: "restaurant-location",
    catalogItem: "forbidden",
  },
  {
    key: "private-events",
    title: "Making a group enquiry",
    requiredFacts: ["phone"],
    requiredAnyIntegrationCapabilities: ["BOOKING", "CONTACT"],
    templateKey: "restaurant-group-enquiry",
    catalogItem: "forbidden",
  },
  {
    key: "dietary-faqs",
    title: "Checking dietary details before ordering",
    requiredFacts: ["catalogItems"],
    templateKey: "restaurant-dietary-enquiry",
    catalogItem: "required",
  },
  {
    key: "chef-story",
    title: "What the current menu confirms",
    requiredFacts: ["catalogItems"],
    templateKey: "restaurant-menu-facts",
    catalogItem: "required",
  },
];

const BEAUTY_TOPICS: ArticleTopicPlan[] = [
  {
    key: "treatment-explainers",
    title: "A current treatment listing",
    requiredFacts: ["catalogItems"],
    templateKey: "beauty-treatment-listing",
    catalogItem: "required",
  },
  {
    key: "aftercare",
    title: "How to ask about aftercare",
    requiredFacts: ["catalogItems"],
    templateKey: "beauty-aftercare-enquiry",
    catalogItem: "required",
  },
  {
    key: "trends",
    title: "What the current service list confirms",
    requiredFacts: ["catalogItems"],
    templateKey: "beauty-current-listing",
    catalogItem: "required",
  },
  {
    key: "first-visit",
    title: "Planning your first visit",
    requiredFacts: ["businessHours", "address"],
    templateKey: "beauty-visit-planning",
    catalogItem: "forbidden",
  },
];

const LOCAL_SERVICE_TOPICS: ArticleTopicPlan[] = [
  {
    key: "service-walkthrough",
    title: "A current service listing",
    requiredFacts: ["catalogItems"],
    templateKey: "service-current-listing",
    catalogItem: "required",
  },
  {
    key: "coverage-area",
    title: "Where the business is based",
    requiredFacts: ["address"],
    templateKey: "service-location",
    catalogItem: "forbidden",
  },
  {
    key: "quote-guide",
    title: "How to make a quote enquiry",
    requiredFacts: ["phone"],
    requiredAnyIntegrationCapabilities: ["QUOTE", "CONTACT"],
    templateKey: "service-quote-enquiry",
    catalogItem: "forbidden",
  },
];

const FOOD_RETAIL_TOPICS: ArticleTopicPlan[] = [
  {
    key: "sourcing-story",
    title: "What a current product listing confirms",
    requiredFacts: ["catalogItems"],
    templateKey: "retail-listing-facts",
    catalogItem: "required",
  },
  {
    key: "seasonal-stock",
    title: "A current shop listing",
    requiredFacts: ["catalogItems"],
    templateKey: "retail-current-stock",
    catalogItem: "required",
  },
  {
    key: "ordering-options",
    title: "Ways to shop with us",
    requiredFacts: [],
    requiredAnyIntegrationCapabilities: ["ORDERING", "DELIVERY"],
    templateKey: "retail-ordering-options",
    catalogItem: "forbidden",
  },
];

/**
 * Per-vertical topic plans. A vertical registers here when it wants the
 * content engine; an unlisted vertical has no plans and generation refuses,
 * which keeps a half-configured niche from emitting filler.
 */
const TOPIC_PLANS: Partial<Record<VerticalId, ArticleTopicPlan[]>> = {
  RESTAURANT: RESTAURANT_TOPICS,
  BEAUTY: BEAUTY_TOPICS,
  LOCAL_SERVICE: LOCAL_SERVICE_TOPICS,
  FOOD_RETAIL: FOOD_RETAIL_TOPICS,
};

export function articleTopicPlansFor(vertical: VerticalId): ArticleTopicPlan[] {
  return TOPIC_PLANS[vertical] ?? [];
}

export function articleTopicPlanByKey(
  vertical: VerticalId,
  key: string,
): ArticleTopicPlan | null {
  return articleTopicPlansFor(vertical).find((plan) => plan.key === key) ?? null;
}
