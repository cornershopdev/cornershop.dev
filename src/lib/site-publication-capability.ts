import type { VerticalId } from "@/lib/verticals/types";
import { isVerticalPublicationMutationEnabled } from "@/lib/verticals/registry";

export const PUBLICATION_UNAVAILABLE_MESSAGE =
  "Publishing is not available for this vertical";

export class SitePublicationCapabilityError extends Error {
  constructor() {
    super(PUBLICATION_UNAVAILABLE_MESSAGE);
    this.name = "SitePublicationCapabilityError";
  }
}

/** Shared fail-closed assertion used by publish and rollback services. */
export function assertVerticalPublicationEnabled(vertical: VerticalId): void {
  if (!isVerticalPublicationMutationEnabled(vertical)) {
    throw new SitePublicationCapabilityError();
  }
}

/**
 * Route-layer capability response. Returning null for enabled verticals keeps
 * authentication and billing policy in their existing handlers.
 */
export function publicationCapabilityFailureResponse(
  vertical: VerticalId,
): Response | null {
  if (isVerticalPublicationMutationEnabled(vertical)) return null;
  return Response.json(
    { error: PUBLICATION_UNAVAILABLE_MESSAGE },
    { status: 409 },
  );
}
