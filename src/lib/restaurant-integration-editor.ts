import {
  canEnableOwnerIntegration,
  createOwnerIntegration,
  mergeOwnerDraftIssues,
  validateOwnerIntegrations,
  zodIssuesToOwnerIssues,
} from "@/lib/owner-integration";
import {
  markRestaurantTranslationsStale,
  type MenuValidationIssue,
} from "@/lib/restaurant-menu-editor";
import type { RestaurantDraft } from "@/lib/restaurant";
import { restaurantDraftSchema } from "@/lib/restaurant";
import { findRestaurantProviderByUrl } from "@/lib/verticals/restaurant/providers";

type RestaurantIntegration = RestaurantDraft["integrations"][number];

export const RESTAURANT_INTEGRATION_TYPES = [
  "booking",
  "ordering",
  "delivery",
  "social",
] as const;

export type RestaurantIntegrationMutation =
  | { type: "add"; integrationType: RestaurantIntegration["type"] }
  | {
      type: "update";
      integrationIndex: number;
      changes: Partial<RestaurantIntegration>;
    }
  | { type: "remove"; integrationIndex: number }
  | {
      type: "move";
      integrationIndex: number;
      direction: -1 | 1;
    };

export function applyRestaurantIntegrationMutation(
  input: RestaurantDraft,
  mutation: RestaurantIntegrationMutation,
): RestaurantDraft {
  const draft = structuredClone(input);
  let translationTextChanged = false;

  switch (mutation.type) {
    case "add": {
      const integration = createOwnerIntegration({
        type: mutation.integrationType,
      });
      draft.integrations.push(integration);
      for (const translation of draft.translations) {
        translation.integrationLabels.push(integration.label);
      }
      translationTextChanged = true;
      break;
    }
    case "update": {
      const integration = requireIntegration(
        draft.integrations,
        mutation.integrationIndex,
      );
      const previousUrl = integration.url;
      const previousProvider = integration.provider;
      Object.assign(integration, mutation.changes);
      if (!canEnableOwnerIntegration(integration.url)) {
        integration.enabled = false;
      }
      if (
        mutation.changes.url !== undefined ||
        mutation.changes.type !== undefined
      ) {
        const matchedProvider = findRestaurantProviderByUrl(integration.url);
        integration.provider = matchedProvider
          ? matchedProvider.name
          : mutation.changes.url !== undefined &&
              !sameHostname(previousUrl, integration.url)
            ? null
            : previousProvider;
        integration.venueId =
          integration.type === "booking" &&
          integration.provider === previousProvider
            ? integration.venueId
            : null;
      }
      translationTextChanged = mutation.changes.label !== undefined;
      break;
    }
    case "remove": {
      requireIntegration(draft.integrations, mutation.integrationIndex);
      draft.integrations.splice(mutation.integrationIndex, 1);
      for (const translation of draft.translations) {
        translation.integrationLabels.splice(mutation.integrationIndex, 1);
      }
      translationTextChanged = true;
      break;
    }
    case "move": {
      const targetIndex =
        mutation.integrationIndex + mutation.direction;
      requireIntegration(draft.integrations, mutation.integrationIndex);
      requireIntegration(draft.integrations, targetIndex);
      move(draft.integrations, mutation.integrationIndex, targetIndex);
      for (const translation of draft.translations) {
        move(
          translation.integrationLabels,
          mutation.integrationIndex,
          targetIndex,
        );
      }
      translationTextChanged = true;
      break;
    }
  }

  return translationTextChanged
    ? markRestaurantTranslationsStale(draft)
    : draft;
}

export function validateRestaurantIntegrations(
  draft: RestaurantDraft,
): MenuValidationIssue[] {
  const ownerIssues = validateOwnerIntegrations(draft.integrations);
  const parsed = restaurantDraftSchema.safeParse(draft);
  const schemaIssues = parsed.success
    ? []
    : zodIssuesToOwnerIssues(parsed.error.issues).filter(
        (issue) =>
          issue.path === "integrations" ||
          issue.path.startsWith("integrations.") ||
          issue.path.includes("integrationLabels"),
      );
  return mergeOwnerDraftIssues(ownerIssues, schemaIssues);
}

export function integrationPlacement(
  type: RestaurantIntegration["type"],
): {
  label: string;
  regions: Array<"header" | "content" | "footer">;
} {
  switch (type) {
    case "booking":
      return {
        label: "Primary reservation action and booking section",
        regions: ["header", "content"],
      };
    case "ordering":
      return {
        label: "Order action near the menu and site header",
        regions: ["header", "content"],
      };
    case "delivery":
      return {
        label: "Delivery action near the menu and site header",
        regions: ["header", "content"],
      };
    case "social":
      return {
        label: "Supporting link; exact position follows the selected theme",
        regions: ["footer"],
      };
  }
}

function requireIntegration(
  integrations: RestaurantIntegration[],
  index: number,
): RestaurantIntegration {
  const integration = integrations[index];
  if (!integration) throw new Error("Integration not found");
  return integration;
}

function move<T>(items: T[], from: number, to: number): void {
  const [item] = items.splice(from, 1);
  if (item === undefined) throw new Error("Integration not found");
  items.splice(to, 0, item);
}

function sameHostname(left: string, right: string): boolean {
  try {
    return new URL(left).hostname === new URL(right).hostname;
  } catch {
    return false;
  }
}
