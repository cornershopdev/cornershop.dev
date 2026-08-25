import type { BookingRequestSite } from "@/lib/booking-requests";
import {
  hasPublicPublishedSnapshot,
  type PublishedDomainRecord,
} from "@/lib/domain-routing";
import { liveSiteVersionId } from "@/lib/site-surface";

/**
 * Visitor-safe copy for every public booking-request admission failure.
 * Distinct 404/403 bodies would let a caller probe whether a slug exists.
 */
export const BOOKING_REQUEST_ADMISSION_REJECTED_MESSAGE =
  "Your request could not be sent. Try again in a moment.";

export const BOOKING_REQUEST_ADMISSION_REJECTED_STATUS = 404;

export type BookingRequestAdmissionSite = BookingRequestSite & {
  status: PublishedDomainRecord["site"]["status"];
  publishedSiteVersionId: string | null;
  publishedSiteVersion: PublishedDomainRecord["site"]["publishedSiteVersion"];
};

export type BookingRequestLiveHost = {
  id: string;
  slug: string;
};

export type BookingRequestSiteLookup = (
  slug: string,
) => Promise<BookingRequestAdmissionSite | null>;

export type BookingRequestLiveHostLookup = (
  headers: Headers,
) => Promise<BookingRequestLiveHost | null>;

/**
 * Fail-closed gate for the unauthenticated booking-request write.
 *
 * Proxy-attested slug/version must match the route, the site's current
 * published snapshot, and the live-host resolver. Missing markers, paused or
 * unpublished sites, stale versions, and resolver misses all return null with
 * no distinction the caller can use to probe slug existence.
 */
export async function admitLiveBookingRequest(input: {
  slug: string;
  headers: Headers;
  lookupSite: BookingRequestSiteLookup;
  resolveLiveHost: BookingRequestLiveHostLookup;
}): Promise<BookingRequestAdmissionSite | null> {
  const versionId = liveSiteVersionId(input.headers, input.slug);
  if (!versionId) return null;

  const site = await input.lookupSite(input.slug);
  if (!site) return null;
  if (!hasPublicPublishedSnapshot(site)) return null;
  if (site.publishedSiteVersionId !== versionId) return null;

  let liveHost: BookingRequestLiveHost | null;
  try {
    liveHost = await input.resolveLiveHost(input.headers);
  } catch {
    return null;
  }
  if (!liveHost || liveHost.id !== site.id || liveHost.slug !== site.slug) {
    return null;
  }
  return site;
}
