import "server-only";
import type { SiteAccess } from "@/lib/authorization-policy";
import { getSiteBillingAccess } from "@/lib/billing-access";
import {
  assembleOwnerPaidWorkspace,
  type OwnerPaidWorkspace,
} from "@/lib/owner-operations";
import { getSitePublicationHistory } from "@/lib/site-publication";
import { resolveOwnerOperations } from "@/lib/verticals/registry";
import { listAccountWorkspaces } from "@/lib/workspaces";

/**
 * Dashboard loader for paid owner operations. Always keyed from the already
 * authorized site membership — cross-tenant slugs never reach these queries.
 */
export async function loadOwnerPaidWorkspace(
  access: SiteAccess,
): Promise<OwnerPaidWorkspace> {
  return assembleOwnerPaidWorkspace(
    access,
    resolveOwnerOperations(access.site.vertical),
    {
      listWorkspaces: listAccountWorkspaces,
      getBillingAccess: getSiteBillingAccess,
      getPublicationHistory: getSitePublicationHistory,
    },
  );
}
