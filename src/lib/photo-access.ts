import "server-only";
import {
  getSiteAccess,
  getSuperadminAccess,
  type AccessFailure,
} from "@/lib/authorization";
import type { Vertical } from "@/generated/prisma/enums";
import { getDb } from "@/lib/db";
import { ownerOperationUnavailableMessage } from "@/lib/owner-operations";
import { resolveOwnerOperations } from "@/lib/verticals/registry";
import type { VerticalId } from "@/lib/verticals/types";

export type PhotoLibraryAccess =
  | {
      ok: true;
      site: { id: string; slug: string; vertical: Vertical };
      actor: { id: string; role: "owner" | "operator" };
    }
  | AccessFailure;

export async function getPhotoLibraryAccess(
  siteSlug: string,
): Promise<PhotoLibraryAccess> {
  const owner = await getSiteAccess(siteSlug);
  if (owner.ok) {
    const denied = photoLibraryUnavailable(owner.site.vertical);
    if (denied) return denied;
    return {
      ok: true,
      site: {
        id: owner.site.id,
        slug: owner.site.slug,
        vertical: owner.site.vertical,
      },
      actor: { id: owner.user.id, role: "owner" },
    };
  }
  const operator = await getSuperadminAccess();
  if (!operator) return owner;
  const site = await getDb().site.findUnique({
    where: { slug: siteSlug },
    select: { id: true, slug: true, vertical: true },
  });
  if (!site) return owner;
  const denied = photoLibraryUnavailable(site.vertical);
  if (denied) return denied;
  return {
    ok: true,
    site,
    actor: { id: operator.id, role: "operator" },
  };
}

function photoLibraryUnavailable(
  vertical: VerticalId,
): AccessFailure | null {
  const state = resolveOwnerOperations(vertical).photoLibrary;
  if (state === "enabled") return null;
  return {
    ok: false,
    status: 403,
    message: ownerOperationUnavailableMessage("photoLibrary", state),
  };
}
