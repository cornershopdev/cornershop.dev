import { Vertical } from "@/generated/prisma/enums";
import { fromRestaurantDraft, restaurantDraftSchema } from "@/lib/restaurant";
import {
  DraftRevisionConflictError,
  updateSiteDraft,
} from "@/lib/site-persistence";
import {
  isVerticalOwnerReviewSupported,
  resolveVerticalConfig,
} from "@/lib/verticals/registry";

type OwnerSiteSaveAccess = {
  site: { vertical: Vertical };
  user: { id: string; email: string };
};

type OwnerSiteDraftUpdater = typeof updateSiteDraft;

/**
 * Authenticated owner-save logic shared by the route and deterministic tests.
 * Authentication and same-origin checks stay in the route; this boundary owns
 * schema selection, required optimistic concurrency, persistence and response
 * semantics.
 */
export async function saveAuthorizedSiteDraft(
  slug: string,
  access: OwnerSiteSaveAccess,
  input: unknown,
  saveDraft: OwnerSiteDraftUpdater = updateSiteDraft,
) {
  if (!isVerticalOwnerReviewSupported(access.site.vertical)) {
    return Response.json(
      {
        error:
          "Owner editing for this vertical is not available yet. Use the private preview until the vertical editor ships.",
      },
      { status: 409 },
    );
  }

  try {
    const body = input as {
      expectedRevision?: unknown;
      [key: string]: unknown;
    };
    const expectedRevision =
      typeof body.expectedRevision === "number" &&
      Number.isInteger(body.expectedRevision) &&
      body.expectedRevision >= 0
        ? body.expectedRevision
        : undefined;
    if (expectedRevision === undefined) {
      return Response.json(
        {
          error: "A valid expectedRevision is required to save this draft",
          code: "EXPECTED_REVISION_REQUIRED",
        },
        { status: 400 },
      );
    }
    const draftBody = { ...body };
    delete draftBody.expectedRevision;
    const draft =
      access.site.vertical === Vertical.RESTAURANT
        ? fromRestaurantDraft(restaurantDraftSchema.parse(draftBody))
        : resolveVerticalConfig(access.site.vertical).draftSchema.parse(
            draftBody,
          );
    const saved = await saveDraft(slug, draft, access.site.vertical, {
      actor: access.user,
      expectedRevision,
    });
    return Response.json({
      ok: true,
      persisted: true,
      revision: saved.revision,
    });
  } catch (error) {
    if (error instanceof DraftRevisionConflictError) {
      return Response.json(
        {
          error: error.message,
          code: "DRAFT_REVISION_CONFLICT",
          currentRevision: error.currentRevision,
        },
        { status: 409 },
      );
    }
    return Response.json(
      {
        error:
          error instanceof Error ? error.message : "Site could not be saved",
      },
      { status: 400 },
    );
  }
}
