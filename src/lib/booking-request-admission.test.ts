import { describe, expect, it, mock } from "bun:test";
import { Vertical } from "@/generated/prisma/enums";
import {
  admitLiveBookingRequest,
  type BookingRequestAdmissionSite,
  type BookingRequestLiveHost,
} from "@/lib/booking-request-admission";
import {
  LIVE_SITE_SLUG_HEADER,
  LIVE_SITE_VERSION_HEADER,
} from "@/lib/site-surface";

const SLUG = "chez-lea";
const VERSION_ID = "sv_live";
const SITE_ID = "site_1";

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

function liveHeaders(
  slug = SLUG,
  versionId = VERSION_ID,
): Headers {
  return new Headers({
    [LIVE_SITE_SLUG_HEADER]: slug,
    [LIVE_SITE_VERSION_HEADER]: versionId,
  });
}

function lookups(options?: {
  site?: BookingRequestAdmissionSite | null;
  host?: BookingRequestLiveHost | null;
  hostError?: Error;
}) {
  const lookupSite = mock(
    async (): Promise<BookingRequestAdmissionSite | null> => {
      if (options && "site" in options) return options.site ?? null;
      return liveSite;
    },
  );
  const resolveLiveHost = mock(
    async (): Promise<BookingRequestLiveHost | null> => {
      if (options?.hostError) throw options.hostError;
      if (options && "host" in options) return options.host ?? null;
      return { id: SITE_ID, slug: SLUG };
    },
  );
  return { lookupSite, resolveLiveHost };
}

describe("live booking-request admission", () => {
  it("admits a matching proxy-attested live slug and current published version", async () => {
    const { lookupSite, resolveLiveHost } = lookups();

    await expect(
      admitLiveBookingRequest({
        slug: SLUG,
        headers: liveHeaders(),
        lookupSite,
        resolveLiveHost,
      }),
    ).resolves.toEqual(liveSite);
    expect(lookupSite).toHaveBeenCalledTimes(1);
    expect(resolveLiveHost).toHaveBeenCalledTimes(1);
  });

  it("rejects missing markers without looking up the site or live host", async () => {
    const { lookupSite, resolveLiveHost } = lookups();

    await expect(
      admitLiveBookingRequest({
        slug: SLUG,
        headers: new Headers(),
        lookupSite,
        resolveLiveHost,
      }),
    ).resolves.toBeNull();
    expect(lookupSite).not.toHaveBeenCalled();
    expect(resolveLiveHost).not.toHaveBeenCalled();
  });

  it("rejects a spoofed slug marker without looking up the site or live host", async () => {
    const { lookupSite, resolveLiveHost } = lookups();

    await expect(
      admitLiveBookingRequest({
        slug: SLUG,
        headers: liveHeaders("someone-elses-site"),
        lookupSite,
        resolveLiveHost,
      }),
    ).resolves.toBeNull();
    expect(lookupSite).not.toHaveBeenCalled();
    expect(resolveLiveHost).not.toHaveBeenCalled();
  });

  it("rejects a route slug that does not match the attested live slug", async () => {
    const { lookupSite, resolveLiveHost } = lookups();

    await expect(
      admitLiveBookingRequest({
        slug: "other-site",
        headers: liveHeaders(),
        lookupSite,
        resolveLiveHost,
      }),
    ).resolves.toBeNull();
    expect(lookupSite).not.toHaveBeenCalled();
    expect(resolveLiveHost).not.toHaveBeenCalled();
  });

  it("rejects a missing site without asking the live-host resolver", async () => {
    const { lookupSite, resolveLiveHost } = lookups({ site: null });

    await expect(
      admitLiveBookingRequest({
        slug: SLUG,
        headers: liveHeaders(),
        lookupSite,
        resolveLiveHost,
      }),
    ).resolves.toBeNull();
    expect(lookupSite).toHaveBeenCalledTimes(1);
    expect(resolveLiveHost).not.toHaveBeenCalled();
  });

  it("rejects a paused site without asking the live-host resolver", async () => {
    const { lookupSite, resolveLiveHost } = lookups({
      site: { ...liveSite, status: "PAUSED" },
    });

    await expect(
      admitLiveBookingRequest({
        slug: SLUG,
        headers: liveHeaders(),
        lookupSite,
        resolveLiveHost,
      }),
    ).resolves.toBeNull();
    expect(lookupSite).toHaveBeenCalledTimes(1);
    expect(resolveLiveHost).not.toHaveBeenCalled();
  });

  it("rejects a preview-only site without asking the live-host resolver", async () => {
    const { lookupSite, resolveLiveHost } = lookups({
      site: { ...liveSite, status: "PREVIEW_READY" },
    });

    await expect(
      admitLiveBookingRequest({
        slug: SLUG,
        headers: liveHeaders(),
        lookupSite,
        resolveLiveHost,
      }),
    ).resolves.toBeNull();
    expect(resolveLiveHost).not.toHaveBeenCalled();
  });

  it("rejects an unpublished site without asking the live-host resolver", async () => {
    const { lookupSite, resolveLiveHost } = lookups({
      site: {
        ...liveSite,
        publishedSiteVersionId: null,
        publishedSiteVersion: null,
      },
    });

    await expect(
      admitLiveBookingRequest({
        slug: SLUG,
        headers: liveHeaders(),
        lookupSite,
        resolveLiveHost,
      }),
    ).resolves.toBeNull();
    expect(resolveLiveHost).not.toHaveBeenCalled();
  });

  it("rejects a stale attested version without asking the live-host resolver", async () => {
    const { lookupSite, resolveLiveHost } = lookups();

    await expect(
      admitLiveBookingRequest({
        slug: SLUG,
        headers: liveHeaders(SLUG, "sv_stale"),
        lookupSite,
        resolveLiveHost,
      }),
    ).resolves.toBeNull();
    expect(lookupSite).toHaveBeenCalledTimes(1);
    expect(resolveLiveHost).not.toHaveBeenCalled();
  });

  it("rejects when the live-host resolver returns null", async () => {
    const { lookupSite, resolveLiveHost } = lookups({ host: null });

    await expect(
      admitLiveBookingRequest({
        slug: SLUG,
        headers: liveHeaders(),
        lookupSite,
        resolveLiveHost,
      }),
    ).resolves.toBeNull();
    expect(lookupSite).toHaveBeenCalledTimes(1);
    expect(resolveLiveHost).toHaveBeenCalledTimes(1);
  });

  it("rejects when the live-host resolver throws", async () => {
    const { lookupSite, resolveLiveHost } = lookups({
      hostError: new Error("resolver unavailable"),
    });

    await expect(
      admitLiveBookingRequest({
        slug: SLUG,
        headers: liveHeaders(),
        lookupSite,
        resolveLiveHost,
      }),
    ).resolves.toBeNull();
    expect(resolveLiveHost).toHaveBeenCalledTimes(1);
  });

  it("rejects a live-host resolver result for a different site", async () => {
    const { lookupSite, resolveLiveHost } = lookups({
      host: { id: "site_other", slug: "other-site" },
    });

    await expect(
      admitLiveBookingRequest({
        slug: SLUG,
        headers: liveHeaders(),
        lookupSite,
        resolveLiveHost,
      }),
    ).resolves.toBeNull();
  });
});
