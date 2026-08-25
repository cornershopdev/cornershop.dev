import { after, NextResponse } from "next/server";
import { z } from "zod";
import {
  LIVE_BOOKING_REQUEST_SOURCE,
  recordLeadCreatedEvent,
  resolveAnalyticsSiteForHeaders,
} from "@/lib/analytics";
import {
  admitLiveBookingRequest,
  BOOKING_REQUEST_ADMISSION_REJECTED_MESSAGE,
  BOOKING_REQUEST_ADMISSION_REJECTED_STATUS,
} from "@/lib/booking-request-admission";
import {
  bookingRequestInputSchema,
  createBookingRequest,
  notifyOwnerOfBookingRequest,
} from "@/lib/booking-requests";
import { getDb } from "@/lib/db";
import { limitBookingRequest } from "@/lib/rate-limit";
import { liveSiteVersionId } from "@/lib/site-surface";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ slug: string }> };

function rejectedAdmissionResponse() {
  return NextResponse.json(
    { error: BOOKING_REQUEST_ADMISSION_REJECTED_MESSAGE },
    { status: BOOKING_REQUEST_ADMISSION_REJECTED_STATUS },
  );
}

/**
 * The one unauthenticated write a generated site exposes to its visitors.
 *
 * Metered before anything else runs. Persist and notify only after a
 * proxy-attested live slug/version matches the route, the current published
 * snapshot, and the live-host resolver. Every admission failure uses one
 * visitor-safe body so the caller cannot probe whether a slug exists.
 */
export async function POST(request: Request, { params }: RouteContext) {
  const { slug } = await params;

  const rateLimit = await limitBookingRequest(request);
  if (!rateLimit.success) {
    const unavailable = rateLimit.reason === "unavailable";
    return NextResponse.json(
      {
        error: unavailable
          ? "Booking requests are temporarily unavailable"
          : "Too many requests from this connection. Try again later.",
      },
      {
        status: unavailable ? 503 : 429,
        headers: {
          "X-RateLimit-Remaining": String(rateLimit.remaining),
          "X-RateLimit-Reset": String(rateLimit.reset),
        },
      },
    );
  }

  try {
    const parsed = bookingRequestInputSchema.parse(await request.json());
    const { analyticsVisitId, ...input } = parsed;

    if (!liveSiteVersionId(request.headers, slug)) {
      return rejectedAdmissionResponse();
    }

    if (!process.env.DATABASE_URL) {
      return NextResponse.json(
        { error: "Booking requests are temporarily unavailable" },
        { status: 503 },
      );
    }

    const site = await admitLiveBookingRequest({
      slug,
      headers: request.headers,
      lookupSite: (liveSlug) =>
        getDb().site.findUnique({
          where: { slug: liveSlug },
          select: {
            id: true,
            name: true,
            slug: true,
            organizationId: true,
            vertical: true,
            status: true,
            publishedSiteVersionId: true,
            publishedSiteVersion: {
              select: { id: true, siteId: true, publishedAt: true },
            },
          },
        }),
      resolveLiveHost: resolveAnalyticsSiteForHeaders,
    });
    if (!site) return rejectedAdmissionResponse();

    const created = await createBookingRequest(
      site,
      input,
      LIVE_BOOKING_REQUEST_SOURCE,
    );
    if (analyticsVisitId) {
      after(async () => {
        try {
          await recordLeadCreatedEvent({
            siteId: site.id,
            visitId: analyticsVisitId,
          });
        } catch (error) {
          console.error("[booking-request] lead analytics dropped", {
            bookingRequestId: created.id,
            error: error instanceof Error ? error.message : "unknown",
          });
        }
      });
    }
    // Awaited rather than fired and forgotten: a floating promise does not
    // survive the response on serverless. It cannot fail the request — the lead
    // is already committed and the visitor is owed a success either way.
    const notified = await notifyOwnerOfBookingRequest(site, created);

    return NextResponse.json({ ok: true, notified });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: error.issues[0]?.message ?? "Check the form and try again" },
        { status: 400 },
      );
    }

    console.error("[booking-request] failed", {
      error: error instanceof Error ? error.message : "unknown",
    });
    return NextResponse.json(
      { error: "Your request could not be sent. Try again in a moment." },
      { status: 500 },
    );
  }
}
