import { afterAll, beforeEach, describe, expect, it, mock } from "bun:test";
import { Vertical } from "@/generated/prisma/enums";
import {
  BOOKING_REQUEST_ADMISSION_REJECTED_MESSAGE,
  BOOKING_REQUEST_ADMISSION_REJECTED_STATUS,
  type BookingRequestAdmissionSite,
} from "@/lib/booking-request-admission";
import { rateLimitTestModule } from "@/lib/complete-test-module-mocks";
import {
  LIVE_SITE_SLUG_HEADER,
  LIVE_SITE_VERSION_HEADER,
} from "@/lib/site-surface";

mock.module("server-only", () => ({}));

const SLUG = "chez-lea";
const VERSION_ID = "sv_live";
const SITE_ID = "site_1";
const LIVE_SOURCE = "live-site-form";

const liveSite: BookingRequestAdmissionSite = {
  id: SITE_ID,
  name: "Chez Léa",
  slug: SLUG,
  organizationId: "org_1",
  vertical: Vertical.RESTAURANT,
  status: "LIVE",
  publishedSiteVersionId: VERSION_ID,
  publishedSiteVersion: {
    id: VERSION_ID,
    siteId: SITE_ID,
    publishedAt: new Date("2026-08-01T00:00:00.000Z"),
  },
};

const createdRequest = {
  id: "br_1",
  name: "Ada",
  email: "ada@example.test",
  phone: null,
  requestedAt: null,
  partySize: null,
  notes: null,
  createdAt: new Date("2026-08-20T12:00:00.000Z"),
};

const callOrder: string[] = [];
let rateLimitResult = {
  success: true,
  remaining: 7,
  reset: Date.now() + 60_000,
  reason: undefined as "limited" | "unavailable" | undefined,
};
let siteRow: BookingRequestAdmissionSite | null = liveSite;
let liveHost: { id: string; slug: string } | null = {
  id: SITE_ID,
  slug: SLUG,
};
let liveHostError: Error | null = null;

const limitBookingRequest = mock(async () => {
  callOrder.push("rateLimit");
  return rateLimitResult;
});
const findUnique = mock(async () => {
  callOrder.push("db");
  return siteRow;
});
const resolveAnalyticsSiteForHeaders = mock(async () => {
  callOrder.push("resolver");
  if (liveHostError) throw liveHostError;
  return liveHost;
});
const createBookingRequest = mock(async () => {
  callOrder.push("create");
  return createdRequest;
});
const notifyOwnerOfBookingRequest = mock(async () => {
  callOrder.push("notify");
  return true;
});
const recordLeadCreatedEvent = mock(async () => "created" as const);

const bookingRequestsActual = await import("@/lib/booking-requests");

mock.module("@/lib/rate-limit", () => ({
  ...rateLimitTestModule,
  limitBookingRequest,
}));
mock.module("@/lib/db", () => ({
  getDb: () => ({
    site: { findUnique },
  }),
}));
mock.module("@/lib/analytics", () => ({
  LIVE_BOOKING_REQUEST_SOURCE: LIVE_SOURCE,
  recordLeadCreatedEvent,
  resolveAnalyticsSiteForHeaders,
}));
mock.module("@/lib/booking-requests", () => ({
  bookingRequestInputSchema: bookingRequestsActual.bookingRequestInputSchema,
  createBookingRequest,
  notifyOwnerOfBookingRequest,
}));

const { POST } = await import(
  "@/app/api/sites/[slug]/booking-requests/route"
);

const previousDatabaseUrl = process.env.DATABASE_URL;

describe("public booking-request route admission", () => {
  beforeEach(() => {
    process.env.DATABASE_URL = "postgresql://unused-by-mocked-test.invalid/db";
    callOrder.length = 0;
    rateLimitResult = {
      success: true,
      remaining: 7,
      reset: Date.now() + 60_000,
      reason: undefined,
    };
    siteRow = liveSite;
    liveHost = { id: SITE_ID, slug: SLUG };
    liveHostError = null;
    limitBookingRequest.mockClear();
    findUnique.mockClear();
    resolveAnalyticsSiteForHeaders.mockClear();
    createBookingRequest.mockClear();
    notifyOwnerOfBookingRequest.mockClear();
    recordLeadCreatedEvent.mockClear();
  });

  afterAll(() => {
    if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousDatabaseUrl;
  });

  it("rate-limits before lookup, resolve, create, or notify", async () => {
    rateLimitResult = {
      success: false,
      remaining: 0,
      reset: Date.now() + 60_000,
      reason: "limited",
    };

    const response = await postBooking();

    expect(response.status).toBe(429);
    expect(callOrder).toEqual(["rateLimit"]);
    expect(findUnique).not.toHaveBeenCalled();
    expect(resolveAnalyticsSiteForHeaders).not.toHaveBeenCalled();
    expect(createBookingRequest).not.toHaveBeenCalled();
    expect(notifyOwnerOfBookingRequest).not.toHaveBeenCalled();
  });

  it("rejects missing markers and factory-host posts without writing", async () => {
    const response = await postBooking({ headers: new Headers() });

    expect(await rejection(response)).toEqual(uniformRejection);
    expect(callOrder).toEqual(["rateLimit"]);
    expect(findUnique).not.toHaveBeenCalled();
    expect(resolveAnalyticsSiteForHeaders).not.toHaveBeenCalled();
    expect(createBookingRequest).not.toHaveBeenCalled();
    expect(notifyOwnerOfBookingRequest).not.toHaveBeenCalled();
  });

  it("rejects spoofed live-site markers without writing", async () => {
    const response = await postBooking({
      headers: liveHeaders("someone-elses-site"),
    });

    expect(await rejection(response)).toEqual(uniformRejection);
    expect(createBookingRequest).not.toHaveBeenCalled();
    expect(notifyOwnerOfBookingRequest).not.toHaveBeenCalled();
    expect(findUnique).not.toHaveBeenCalled();
    expect(resolveAnalyticsSiteForHeaders).not.toHaveBeenCalled();
  });

  it("rejects a paused site without writing", async () => {
    siteRow = { ...liveSite, status: "PAUSED" };

    const response = await postBooking();

    expect(await rejection(response)).toEqual(uniformRejection);
    expect(callOrder).toEqual(["rateLimit", "db"]);
    expect(resolveAnalyticsSiteForHeaders).not.toHaveBeenCalled();
    expect(createBookingRequest).not.toHaveBeenCalled();
    expect(notifyOwnerOfBookingRequest).not.toHaveBeenCalled();
  });

  it("rejects a preview-only site without writing", async () => {
    siteRow = { ...liveSite, status: "PREVIEW_READY" };

    const response = await postBooking();

    expect(await rejection(response)).toEqual(uniformRejection);
    expect(createBookingRequest).not.toHaveBeenCalled();
    expect(notifyOwnerOfBookingRequest).not.toHaveBeenCalled();
  });

  it("rejects an unpublished site without writing", async () => {
    siteRow = {
      ...liveSite,
      publishedSiteVersionId: null,
      publishedSiteVersion: null,
    };

    const response = await postBooking();

    expect(await rejection(response)).toEqual(uniformRejection);
    expect(createBookingRequest).not.toHaveBeenCalled();
    expect(notifyOwnerOfBookingRequest).not.toHaveBeenCalled();
  });

  it("rejects a stale attested version without writing", async () => {
    const response = await postBooking({
      headers: liveHeaders(SLUG, "sv_stale"),
    });

    expect(await rejection(response)).toEqual(uniformRejection);
    expect(callOrder).toEqual(["rateLimit", "db"]);
    expect(resolveAnalyticsSiteForHeaders).not.toHaveBeenCalled();
    expect(createBookingRequest).not.toHaveBeenCalled();
    expect(notifyOwnerOfBookingRequest).not.toHaveBeenCalled();
  });

  it("rejects a mismatched route slug without writing", async () => {
    const response = await postBooking({ slug: "other-site" });

    expect(await rejection(response)).toEqual(uniformRejection);
    expect(findUnique).not.toHaveBeenCalled();
    expect(resolveAnalyticsSiteForHeaders).not.toHaveBeenCalled();
    expect(createBookingRequest).not.toHaveBeenCalled();
    expect(notifyOwnerOfBookingRequest).not.toHaveBeenCalled();
  });

  it("rejects an unknown slug with the same body as a paused live site", async () => {
    siteRow = null;

    const response = await postBooking();

    expect(await rejection(response)).toEqual(uniformRejection);
    expect(callOrder).toEqual(["rateLimit", "db"]);
    expect(createBookingRequest).not.toHaveBeenCalled();
    expect(notifyOwnerOfBookingRequest).not.toHaveBeenCalled();
  });

  it("rejects a null live-host resolver without writing", async () => {
    liveHost = null;

    const response = await postBooking();

    expect(await rejection(response)).toEqual(uniformRejection);
    expect(callOrder).toEqual(["rateLimit", "db", "resolver"]);
    expect(createBookingRequest).not.toHaveBeenCalled();
    expect(notifyOwnerOfBookingRequest).not.toHaveBeenCalled();
  });

  it("rejects a live-host resolver error without writing", async () => {
    liveHostError = new Error("resolver unavailable");

    const response = await postBooking();

    expect(await rejection(response)).toEqual(uniformRejection);
    expect(callOrder).toEqual(["rateLimit", "db", "resolver"]);
    expect(createBookingRequest).not.toHaveBeenCalled();
    expect(notifyOwnerOfBookingRequest).not.toHaveBeenCalled();
  });

  it("persists and notifies only after a matching live admission", async () => {
    const response = await postBooking();

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, notified: true });
    expect(callOrder).toEqual([
      "rateLimit",
      "db",
      "resolver",
      "create",
      "notify",
    ]);
    expect(createBookingRequest).toHaveBeenCalledWith(
      liveSite,
      expect.objectContaining({
        name: "Ada",
        email: "ada@example.test",
      }),
      LIVE_SOURCE,
    );
    expect(notifyOwnerOfBookingRequest).toHaveBeenCalledWith(
      liveSite,
      createdRequest,
    );
  });
});

const uniformRejection = {
  status: BOOKING_REQUEST_ADMISSION_REJECTED_STATUS,
  error: BOOKING_REQUEST_ADMISSION_REJECTED_MESSAGE,
};

async function rejection(response: Response) {
  const payload = (await response.json()) as { error?: string };
  return { status: response.status, error: payload.error };
}

function liveHeaders(slug = SLUG, versionId = VERSION_ID) {
  return new Headers({
    [LIVE_SITE_SLUG_HEADER]: slug,
    [LIVE_SITE_VERSION_HEADER]: versionId,
  });
}

function postBooking(options?: {
  slug?: string;
  headers?: Headers;
  body?: Record<string, unknown>;
}) {
  const headers = options?.headers ?? liveHeaders();
  headers.set("content-type", "application/json");
  return POST(
    new Request(
      `https://chez-lea.restofront.com/api/sites/${options?.slug ?? SLUG}/booking-requests`,
      {
        method: "POST",
        headers,
        body: JSON.stringify(
          options?.body ?? {
            name: "Ada",
            email: "ada@example.test",
          },
        ),
      },
    ),
    { params: Promise.resolve({ slug: options?.slug ?? SLUG }) },
  );
}
