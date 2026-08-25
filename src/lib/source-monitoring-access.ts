import "server-only";
import {
  getSiteAccess,
  getSuperadminAccess,
  type AccessFailure,
} from "@/lib/authorization";
import { getDb } from "@/lib/db";
import { ownerOperationUnavailableMessage } from "@/lib/owner-operations";
import { resolveOwnerOperations } from "@/lib/verticals/registry";
import type { VerticalId } from "@/lib/verticals/types";

export type SourceMonitoringAccess =
  | {
      ok: true;
      site: { id: string; slug: string };
      actor: {
        id: string;
        email: string;
        role: "owner" | "operator";
      };
    }
  | AccessFailure;

export async function getSourceMonitoringAccess(
  siteSlug: string,
): Promise<SourceMonitoringAccess> {
  const owner = await getSiteAccess(siteSlug);
  if (owner.ok) {
    const denied = sourceMonitoringUnavailable(owner.site.vertical);
    if (denied) return denied;
    return {
      ok: true,
      site: { id: owner.site.id, slug: owner.site.slug },
      actor: {
        id: owner.user.id,
        email: owner.user.email,
        role: "owner",
      },
    };
  }

  const operator = await getSuperadminAccess();
  if (!operator) return owner;
  const site = await getDb().site.findUnique({
    where: { slug: siteSlug },
    select: { id: true, slug: true, vertical: true },
  });
  if (!site) {
    return {
      ok: false,
      status: 403,
      message: "Site access is required",
    };
  }
  const denied = sourceMonitoringUnavailable(site.vertical);
  if (denied) return denied;
  return {
    ok: true,
    site: { id: site.id, slug: site.slug },
    actor: {
      id: operator.id,
      email: operator.email,
      role: "operator",
    },
  };
}

function sourceMonitoringUnavailable(
  vertical: VerticalId,
): AccessFailure | null {
  const state = resolveOwnerOperations(vertical).sourceMonitoring;
  if (state === "enabled") return null;
  return {
    ok: false,
    status: 403,
    message: ownerOperationUnavailableMessage("sourceMonitoring", state),
  };
}
