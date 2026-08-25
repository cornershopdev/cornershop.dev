import { z } from "zod";
import { Vertical } from "@/generated/prisma/enums";
import { accessFailureResponse } from "@/lib/authorization";
import {
  restaurantSiteDraftSchema,
  toRestaurantDraft,
} from "@/lib/restaurant";
import {
  reviewSourceMonitoringSuggestion,
  SourceMonitoringConflictError,
  SourceMonitoringUnsupportedSuggestionError,
} from "@/lib/source-monitoring";
import { getSourceMonitoringAccess } from "@/lib/source-monitoring-access";
import { isSameOriginMutation } from "@/lib/request-origin";
import { DraftRevisionConflictError } from "@/lib/site-persistence";
import { resolveVerticalConfig } from "@/lib/verticals/registry";

const reviewSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("accept"),
    editedValue: z.unknown().optional(),
    note: z.string().trim().max(500).optional(),
    expectedRevision: z.number().int().min(0),
  }),
  z.object({
    action: z.literal("reject"),
    note: z.string().trim().max(500).optional(),
  }),
]);

export async function PATCH(
  request: Request,
  {
    params,
  }: RouteContext<
    "/api/sites/[slug]/source-monitoring/suggestions/[suggestionId]"
  >,
) {
  if (!isSameOriginMutation(request, { requireOrigin: true })) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }
  const { slug, suggestionId } = await params;
  const access = await getSourceMonitoringAccess(slug);
  if (!access.ok) return accessFailureResponse(access);

  const parsed = reviewSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: "Invalid review action" }, { status: 400 });
  }
  try {
    const result = await reviewSourceMonitoringSuggestion({
      siteId: access.site.id,
      suggestionId,
      actor: access.actor,
      ...parsed.data,
    });
    const ownerDraft =
      result.status === "ACCEPTED" && result.vertical && result.draft !== undefined
        ? toOwnerReviewDraft(result.vertical, result.draft)
        : undefined;
    return Response.json({
      status: result.status,
      ...(result.revision === undefined ? {} : { revision: result.revision }),
      ...(ownerDraft === undefined ? {} : { draft: ownerDraft }),
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
    if (error instanceof SourceMonitoringConflictError) {
      return Response.json({ error: error.message }, { status: 409 });
    }
    if (error instanceof SourceMonitoringUnsupportedSuggestionError) {
      return Response.json(
        { error: error.message, code: "UNSUPPORTED_SUGGESTION" },
        { status: 422 },
      );
    }
    if (error instanceof z.ZodError) {
      return Response.json(
        {
          error:
            "This suggestion is not valid for this workspace. Nothing was saved to the private draft.",
        },
        { status: 422 },
      );
    }
    console.error("[source-monitoring] review failed", {
      slug,
      suggestionId,
      error: error instanceof Error ? error.message : "unknown",
    });
    return Response.json(
      { error: "The suggestion could not be reviewed" },
      { status: 500 },
    );
  }
}

function toOwnerReviewDraft(vertical: Vertical, draft: unknown) {
  if (vertical === Vertical.RESTAURANT) {
    return toRestaurantDraft(restaurantSiteDraftSchema.parse(draft));
  }
  return resolveVerticalConfig(vertical).draftSchema.parse(draft);
}
