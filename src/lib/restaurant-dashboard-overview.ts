import type { RestaurantDraft } from "@/lib/restaurant";

type RestaurantOverviewDraft = Pick<
  RestaurantDraft,
  "menuSections" | "integrations"
>;

export type RestaurantDashboardOverview = {
  menuItemCount: number;
  menuSectionCount: number;
  enabledLinkCount: number;
  menuComplete: boolean;
  bookingComplete: boolean;
};

export function buildRestaurantDashboardOverview(
  draft: RestaurantOverviewDraft,
): RestaurantDashboardOverview {
  const menuItemCount = draft.menuSections.reduce(
    (sum, section) => sum + section.items.length,
    0,
  );
  const enabledLinks = draft.integrations.filter(
    (integration) => integration.enabled !== false,
  );

  return {
    menuItemCount,
    menuSectionCount: draft.menuSections.length,
    enabledLinkCount: enabledLinks.length,
    menuComplete: menuItemCount > 0,
    bookingComplete: enabledLinks.some(
      (integration) => integration.type === "booking",
    ),
  };
}
