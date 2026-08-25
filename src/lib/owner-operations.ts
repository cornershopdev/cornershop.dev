import type { SiteAccess } from "@/lib/authorization-policy";
import type { BillingAccess } from "@/lib/billing-access";
import type {
  OwnerOperationId,
  OwnerOperationState,
  VerticalOwnerOperations,
} from "@/lib/verticals/types";

export type ClientPublicationHistoryItem = {
  id: string;
  version: number;
  publishedAt: string;
  changeSummary: string;
  current: boolean;
  theme: {
    id: string;
    version: string;
  };
};

export type OwnerWorkspaceMembership = {
  id: string;
  slug: string;
  name: string;
};

export type OwnerPaidWorkspace = {
  capabilities: VerticalOwnerOperations;
  billingAccess: BillingAccess | null;
  publicationHistory: ClientPublicationHistoryItem[];
  workspaces: OwnerWorkspaceMembership[];
  canSwitchWorkspace: boolean;
};

export type OwnerPaidOperationsHookInput = {
  siteSlug: string;
  platformUrl: string;
  brandName: string;
  capabilities: VerticalOwnerOperations;
  billingAccess: BillingAccess | null;
  initialPublicationHistory: ClientPublicationHistoryItem[];
  isDemo?: boolean;
};

export type RecordPublishedVersionInput = {
  id: string;
  version: number;
  publishedAt: string;
  changeSummary: string;
  theme: { id: string; version: string };
};

export const UNAVAILABLE_OWNER_OPERATION_IDS = [
  "analytics",
  "bookingInbox",
  "sourceMonitoring",
  "articles",
  "photoLibrary",
] as const satisfies readonly OwnerOperationId[];

export type OwnerPaidWorkspaceLoaders = {
  listWorkspaces: (userId: string) => Promise<OwnerWorkspaceMembership[]>;
  getBillingAccess: (siteId: string) => Promise<BillingAccess | null>;
  getPublicationHistory: (
    siteId: string,
  ) => Promise<
    Array<
      Omit<ClientPublicationHistoryItem, "publishedAt"> & {
        publishedAt: Date | string;
      }
    >
  >;
};

/**
 * Membership-scoped paid-ops snapshot. Loaders receive only the authorized
 * site id and the session user id — never a caller-supplied foreign id.
 */
export async function assembleOwnerPaidWorkspace(
  access: Pick<SiteAccess, "site" | "session">,
  capabilities: VerticalOwnerOperations,
  loaders: OwnerPaidWorkspaceLoaders,
): Promise<OwnerPaidWorkspace> {
  const [workspaces, billingAccess, publicationHistory] = await Promise.all([
    loaders.listWorkspaces(access.session.userId),
    isOwnerOperationEnabled(capabilities.billing)
      ? loaders.getBillingAccess(access.site.id)
      : Promise.resolve(null),
    isOwnerOperationEnabled(capabilities.publicationHistory)
      ? loaders.getPublicationHistory(access.site.id)
      : Promise.resolve([]),
  ]);
  return {
    capabilities,
    billingAccess,
    publicationHistory: toClientPublicationHistory(publicationHistory),
    workspaces,
    canSwitchWorkspace: workspaces.length > 1,
  };
}

export type OwnerOperationCopy = {
  title: string;
  gated: string;
  notYet: string;
  unsupported: string;
};

const paidOwnerReviewOperations = {
  billing: "enabled",
  publicationHistory: "enabled",
  publicationMutation: "enabled",
  customDomain: "enabled",
  workspaceSwitching: "enabled",
} as const satisfies Pick<
  VerticalOwnerOperations,
  | "billing"
  | "publicationHistory"
  | "publicationMutation"
  | "customDomain"
  | "workspaceSwitching"
>;

/** Restaurant owns the full paid workspace, including analytics and monitoring. */
export const restaurantOwnerOperations = {
  ...paidOwnerReviewOperations,
  analytics: "enabled",
  bookingInbox: "enabled",
  sourceMonitoring: "enabled",
  articles: "enabled",
  photoLibrary: "enabled",
} as const satisfies VerticalOwnerOperations;

/**
 * Food-retail and local-service share billing, publication, domain,
 * workspace switching, source-monitoring review, and the reviewed photo
 * library. Articles, analytics, and leads stay explicit not-yet states.
 */
export const foodRetailOwnerOperations = {
  ...paidOwnerReviewOperations,
  analytics: "not-yet",
  bookingInbox: "not-yet",
  sourceMonitoring: "enabled",
  articles: "not-yet",
  photoLibrary: "enabled",
} as const satisfies VerticalOwnerOperations;

export const localServiceOwnerOperations = foodRetailOwnerOperations;

/** Beauty has no owner-review dashboard; every paid operation stays closed. */
export const beautyOwnerOperations = {
  billing: "unsupported",
  publicationHistory: "unsupported",
  publicationMutation: "unsupported",
  customDomain: "unsupported",
  workspaceSwitching: "unsupported",
  analytics: "unsupported",
  bookingInbox: "unsupported",
  sourceMonitoring: "unsupported",
  articles: "unsupported",
  photoLibrary: "unsupported",
} as const satisfies VerticalOwnerOperations;

export const OWNER_OPERATION_COPY: Record<OwnerOperationId, OwnerOperationCopy> =
  {
    billing: {
      title: "Subscription and billing",
      gated: "Subscription billing is not available for this vertical yet.",
      notYet: "Subscription billing is not ready for this workspace yet.",
      unsupported: "Subscription billing is not available for this vertical.",
    },
    publicationHistory: {
      title: "Publication history",
      gated: "Publication history is not available for this vertical yet.",
      notYet: "Publication history is not ready for this workspace yet.",
      unsupported: "Publication history is not available for this vertical.",
    },
    publicationMutation: {
      title: "Publish and rollback",
      gated: "Publishing is not available for this vertical.",
      notYet: "Publishing is not ready for this workspace yet.",
      unsupported: "Publishing is not available for this vertical.",
    },
    customDomain: {
      title: "Custom domain",
      gated: "Custom domains are not available for this vertical yet.",
      notYet: "Custom domain setup is not ready for this workspace yet.",
      unsupported: "Custom domains are not available for this vertical.",
    },
    workspaceSwitching: {
      title: "Workspace switching",
      gated: "Workspace switching is not available for this account yet.",
      notYet: "Workspace switching is not ready for this workspace yet.",
      unsupported: "Workspace switching is not available for this vertical.",
    },
    analytics: {
      title: "Analytics",
      gated: "Analytics is not available for this vertical yet.",
      notYet: "Analytics is not ready for this workspace yet.",
      unsupported: "Analytics is not available for this vertical.",
    },
    bookingInbox: {
      title: "Leads",
      gated: "The lead inbox is not available for this vertical yet.",
      notYet: "The lead inbox is not ready for this workspace yet.",
      unsupported: "The lead inbox is not available for this vertical.",
    },
    sourceMonitoring: {
      title: "Source monitoring",
      gated: "Source monitoring is not available for this vertical yet.",
      notYet: "Source monitoring is not ready for this workspace yet.",
      unsupported: "Source monitoring is not available for this vertical.",
    },
    articles: {
      title: "Articles",
      gated: "Articles are not available for this vertical yet.",
      notYet: "Articles are not ready for this workspace yet.",
      unsupported: "Articles are not available for this vertical.",
    },
    photoLibrary: {
      title: "Photo library",
      gated: "The photo library is not available for this vertical yet.",
      notYet: "The photo library is not ready for this workspace yet.",
      unsupported: "The photo library is not available for this vertical.",
    },
  };

export function isOwnerOperationEnabled(
  state: OwnerOperationState,
): boolean {
  return state === "enabled";
}

export function ownerOperationUnavailableMessage(
  id: OwnerOperationId,
  state: Exclude<OwnerOperationState, "enabled">,
): string {
  const copy = OWNER_OPERATION_COPY[id];
  if (state === "gated") return copy.gated;
  if (state === "not-yet") return copy.notYet;
  return copy.unsupported;
}

/**
 * Claim and publication-mutation flags win over a leftover `enabled` value.
 * Dashboards must call `resolveOwnerOperations`, not this, so a preview-only
 * vertical cannot inherit paid mutations from config drift.
 */
export function applyOwnerOperationInvariants(
  declared: VerticalOwnerOperations,
  gates: {
    claimEnabled: boolean;
    publicationMutationEnabled: boolean;
  },
): VerticalOwnerOperations {
  return {
    ...declared,
    billing: failClosedIfEnabled(declared.billing, gates.claimEnabled),
    customDomain: failClosedIfEnabled(
      declared.customDomain,
      gates.claimEnabled,
    ),
    publicationMutation: failClosedIfEnabled(
      declared.publicationMutation,
      gates.publicationMutationEnabled,
    ),
  };
}

export function toClientPublicationHistory(
  items: Array<
    Omit<ClientPublicationHistoryItem, "publishedAt"> & {
      publishedAt: Date | string;
    }
  >,
): ClientPublicationHistoryItem[] {
  return items.map((item) => ({
    ...item,
    publishedAt:
      item.publishedAt instanceof Date
        ? item.publishedAt.toISOString()
        : item.publishedAt,
  }));
}

function failClosedIfEnabled(
  state: OwnerOperationState,
  allowed: boolean,
): OwnerOperationState {
  if (state === "enabled" && !allowed) return "gated";
  return state;
}
