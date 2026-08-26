import { randomBytes } from "node:crypto";
import { resolve4, resolveCname } from "node:dns/promises";
import { revalidateTag } from "next/cache";
import type { Prisma } from "@/generated/prisma/client";
import type { DomainTlsStatus, SiteStatus } from "@/generated/prisma/enums";
import { z } from "zod";
import {
  accessFailureResponse,
  getSiteAccess,
} from "@/lib/authorization";
import {
  billingAccessFailureResponse,
  getSiteBillingAccess,
} from "@/lib/billing-access";
import { getCurrentSession } from "@/lib/current-session";
import { getDb } from "@/lib/db";
import { claimDomainSetForSite } from "@/lib/domain-claim";
import {
  planDomainHostnames,
  publicSiteOrigin,
  siteStatusForDomainState,
  type DomainHostnamePlan,
} from "@/lib/domain-routing";
import { checkDomainTls } from "@/lib/domain-tls";
import {
  invalidateDomainLookupHostnames,
  invalidatePlatformSiteSlug,
} from "@/lib/domain-lookup-cache";
import {
  isFactoryHostname,
  isReservedPlatformHostname,
  parsePlatformSubdomain,
} from "@/lib/hostnames";
import { isSameOriginMutation } from "@/lib/request-origin";
import { previewCacheTagFor } from "@/lib/site-surface";
import type { VerticalId } from "@/lib/verticals/types";

const hostnameSchema = z
  .string()
  .trim()
  .toLowerCase()
  .transform((value) =>
    value.replace(/^https?:\/\//, "").replace(/\/.*$/, "").replace(/\.$/, ""),
  )
  .pipe(
    z
      .string()
      .min(4)
      .max(253)
      .regex(
        /^(?=.{4,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/,
        "Enter a valid domain name",
      ),
  );
const siteSlugSchema = z.string().min(2).max(80);

type DomainRow = {
  hostname: string;
  verified: boolean;
  tlsStatus: DomainTlsStatus;
  tlsCheckedAt: Date | null;
  tlsFailureCode: string | null;
};

function getDomainTarget() {
  const address = process.env.PUBLIC_APP_IP;
  const cname = process.env.CUSTOM_DOMAIN_CNAME;
  if (!address || !cname) {
    throw new Error("Customer domain routing is not configured");
  }
  return { address, cname: cname.replace(/\.$/, "").toLowerCase() };
}

export async function POST(request: Request) {
  try {
    if (!isSameOriginMutation(request, { requireOrigin: true })) {
      return Response.json({ error: "Forbidden" }, { status: 403 });
    }
    const body = (await request.json()) as {
      hostname?: string;
      siteSlug?: string;
    };
    const hostname = hostnameSchema.parse(body.hostname);
    if (
      isFactoryHostname(hostname) ||
      parsePlatformSubdomain(hostname) !== null ||
      isReservedPlatformHostname(hostname)
    ) {
      return Response.json(
        { error: "This hostname is reserved for Cornershopdev" },
        { status: 409 },
      );
    }

    const session = await getCurrentSession();
    const siteSlug = siteSlugSchema.parse(body.siteSlug ?? session?.siteSlug);
    const access = await getSiteAccess(siteSlug);
    if (!access.ok) return accessFailureResponse(access);
    const billing = await getSiteBillingAccess(access.site.id);
    if (!billing.ok) return billingAccessFailureResponse(billing);

    const db = getDb();
    const target = getDomainTarget();
    const plan = planDomainHostnames(hostname);
    const claimed = await claimDomainSetForSite(
      {
        runSerializable: (operation) =>
          db.$transaction(
            (transaction) =>
              operation({
                findOwner: async (candidateHostname) =>
                  (
                    await transaction.domain.findUnique({
                      where: { hostname: candidateHostname },
                      select: { siteId: true },
                    })
                  )?.siteId ?? null,
                create: async (data) => {
                  await transaction.domain.create({ data });
                },
              }),
            { isolationLevel: "Serializable" },
          ),
      },
      plan.hostnames.map((candidateHostname) => ({
        hostname: candidateHostname,
        siteId: access.site.id,
        verificationToken: randomBytes(24).toString("base64url"),
      })),
    );
    if (!claimed) {
      return Response.json(
        { error: "This domain is already connected to another site" },
        { status: 409 },
      );
    }

    const [rows, site] = await Promise.all([
      db.domain.findMany({
        where: {
          siteId: access.site.id,
          hostname: { in: plan.hostnames },
        },
        select: domainRowSelect,
      }),
      db.site.findUnique({
        where: { id: access.site.id },
        select: { status: true },
      }),
    ]);
    if (!site) throw new Error("Site not found");
    invalidateDomainLookupHostnames(plan.hostnames);
    invalidatePlatformSiteSlug(access.site.slug);
    return Response.json(
      domainSetup(
        plan,
        rows,
        target,
        site.status,
        access.site.slug,
        access.site.vertical,
        false,
      ),
    );
  } catch (error) {
    return domainFailure(error, "Domain could not be added");
  }
}

/**
 * Read-only listing. DNS/TLS verification is intentionally not a GET side effect
 * (safe methods must not mutate); use PATCH to recheck a hostname.
 */
export async function GET(request: Request) {
  try {
    const searchParams = new URL(request.url).searchParams;
    if (searchParams.get("hostname")) {
      return Response.json(
        {
          error:
            "Use PATCH /api/domains with { hostname, siteSlug } to recheck DNS",
        },
        { status: 405, headers: { Allow: "GET, POST, PATCH, DELETE" } },
      );
    }
    const siteSlug = siteSlugSchema.parse(searchParams.get("siteSlug"));
    const access = await getSiteAccess(siteSlug);
    if (!access.ok) return accessFailureResponse(access);

    const db = getDb();
    const target = getDomainTarget();
    const [rows, site] = await Promise.all([
      db.domain.findMany({
        where: { siteId: access.site.id },
        select: domainRowSelect,
        orderBy: { createdAt: "asc" },
      }),
      db.site.findUnique({
        where: { id: access.site.id },
        select: { status: true },
      }),
    ]);
    if (!site) throw new Error("Site not found");
    return Response.json({
      domains: domainSetups(
        rows,
        target,
        site.status,
        access.site.slug,
        access.site.vertical,
      ),
    });
  } catch (error) {
    return domainFailure(error, "Domains could not be loaded");
  }
}

/** Recheck DNS + TLS for an attached hostname and persist the result. */
export async function PATCH(request: Request) {
  try {
    if (!isSameOriginMutation(request, { requireOrigin: true })) {
      return Response.json({ error: "Forbidden" }, { status: 403 });
    }
    const body = (await request.json()) as {
      hostname?: string;
      siteSlug?: string;
    };
    const hostname = hostnameSchema.parse(body.hostname);
    const siteSlug = siteSlugSchema.parse(body.siteSlug);
    const access = await getSiteAccess(siteSlug);
    if (!access.ok) return accessFailureResponse(access);

    const db = getDb();
    const target = getDomainTarget();
    const plan = planDomainHostnames(hostname);
    const existing = await db.domain.findMany({
      where: {
        siteId: access.site.id,
        hostname: { in: plan.hostnames },
      },
      select: domainRowSelect,
    });
    if (!existing.length) {
      return Response.json({ error: "Domain not found" }, { status: 404 });
    }

    const checkedAt = new Date();
    const checked = await Promise.all(
      existing.map(async (row) => {
        const record = plan.records.find(
          (candidate) => candidate.hostname === row.hostname,
        );
        if (!record) {
          return {
            ...row,
            verifiedAt: row.verified ? checkedAt : null,
          };
        }
        const verified = await recordResolves(record, target);
        const tls = verified
          ? await checkDomainTls(row.hostname, target.address)
          : {
              status: "PENDING" as const,
              failureCode: null,
              message: "Waiting for DNS before checking the secure connection.",
            };
        return {
          ...row,
          verified,
          verifiedAt: verified ? checkedAt : null,
          tlsStatus: tls.status,
          tlsCheckedAt: verified ? checkedAt : null,
          tlsFailureCode: tls.failureCode,
        };
      }),
    );

    const siteStatus = await db.$transaction(
      async (transaction) => {
        for (const row of checked) {
          await transaction.domain.updateMany({
            where: { hostname: row.hostname, siteId: access.site.id },
            data: {
              verified: row.verified,
              verifiedAt: row.verifiedAt,
              tlsStatus: row.tlsStatus,
              tlsCheckedAt: row.tlsCheckedAt,
              tlsFailureCode: row.tlsFailureCode,
            },
          });
        }
        return reconcileSiteStatus(transaction, access.site.id);
      },
      { isolationLevel: "Serializable" },
    );
    // Unconditional: this DNS check already spent seconds on network I/O, so
    // an extra revalidateTag call is negligible, and it is the only place a
    // verification (or a verified domain going stale) is discovered.
    revalidateTag(previewCacheTagFor(access.site.slug), { expire: 0 });

    invalidateDomainLookupHostnames(plan.hostnames);
    invalidatePlatformSiteSlug(access.site.slug);
    return Response.json(
      domainSetup(
        plan,
        checked,
        target,
        siteStatus,
        access.site.slug,
        access.site.vertical,
        true,
      ),
    );
  } catch (error) {
    return domainFailure(error, "DNS could not be checked");
  }
}

export async function DELETE(request: Request) {
  try {
    if (!isSameOriginMutation(request, { requireOrigin: true })) {
      return Response.json({ error: "Forbidden" }, { status: 403 });
    }
    const body = (await request.json()) as {
      hostname?: string;
      siteSlug?: string;
    };
    const hostname = hostnameSchema.parse(body.hostname);
    const siteSlug = siteSlugSchema.parse(body.siteSlug);
    const access = await getSiteAccess(siteSlug);
    if (!access.ok) return accessFailureResponse(access);

    const plan = planDomainHostnames(hostname);
    const db = getDb();
    const result = await db.$transaction(
      async (transaction) => {
        const rows = await transaction.domain.findMany({
          where: {
            siteId: access.site.id,
            hostname: { in: plan.hostnames },
          },
          select: { id: true, hostname: true },
        });
        if (!rows.length) return null;

        await transaction.domain.deleteMany({
          where: {
            siteId: access.site.id,
            id: { in: rows.map((row) => row.id) },
          },
        });
        const siteStatus = await reconcileSiteStatus(
          transaction,
          access.site.id,
        );
        await transaction.auditEvent.create({
          data: {
            type: "domain.removed",
            actor: access.user.id,
            siteId: access.site.id,
            metadata: {
              actorEmail: access.user.email,
              canonicalHostname: plan.canonicalHostname,
              hostnames: rows.map((row) => row.hostname),
              resultingStatus: siteStatus,
            },
          },
        });
        return {
          hostnames: rows.map((row) => row.hostname),
          siteStatus,
        };
      },
      { isolationLevel: "Serializable" },
    );
    if (!result) {
      return Response.json({ error: "Domain not found" }, { status: 404 });
    }
    // Removing a verified domain can drop the site's last verified hostname,
    // flipping status away from LIVE; the cached live surface must reflect
    // that immediately rather than on its next natural revalidation.
    revalidateTag(previewCacheTagFor(access.site.slug), { expire: 0 });

    invalidateDomainLookupHostnames(result.hostnames);
    invalidatePlatformSiteSlug(access.site.slug);
    return Response.json({
      removed: true,
      hostnames: result.hostnames,
      siteStatus: result.siteStatus,
      previewPath: `/preview/${access.site.slug}`,
      publicUrl: publicSiteOrigin({
        slug: access.site.slug,
        vertical: access.site.vertical,
      }),
    });
  } catch (error) {
    return domainFailure(error, "Domain could not be removed");
  }
}

const domainRowSelect = {
  hostname: true,
  verified: true,
  tlsStatus: true,
  tlsCheckedAt: true,
  tlsFailureCode: true,
} as const;

function domainSetups(
  rows: DomainRow[],
  target: ReturnType<typeof getDomainTarget>,
  siteStatus: SiteStatus,
  siteSlug: string,
  vertical: VerticalId,
) {
  const plans = new Map<string, DomainHostnamePlan>();
  for (const row of rows) {
    const plan = planDomainHostnames(row.hostname);
    plans.set(plan.canonicalHostname, plan);
  }
  return [...plans.values()].map((plan) =>
    domainSetup(plan, rows, target, siteStatus, siteSlug, vertical, false),
  );
}

function domainSetup(
  plan: DomainHostnamePlan,
  rows: DomainRow[],
  target: ReturnType<typeof getDomainTarget>,
  siteStatus: SiteStatus,
  siteSlug: string,
  vertical: VerticalId,
  dnsChecked: boolean,
) {
  const plannedRows = rows.filter((row) => plan.hostnames.includes(row.hostname));
  const verifiedRows = plannedRows.filter((row) => row.verified);
  const tls = aggregateTls(verifiedRows);
  const verified =
    plannedRows.length === plan.hostnames.length &&
    plannedRows.every((row) => row.verified);
  return {
    hostname: plan.canonicalHostname,
    hostnames: plan.hostnames,
    attached: plannedRows.length === plan.hostnames.length,
    verified,
    dnsChecked,
    records: plan.records.map((record) => ({
      type: record.type,
      name: record.name,
      value: record.type === "A" ? target.address : target.cname,
    })),
    tls,
    siteStatus,
    previewPath: `/preview/${siteSlug}`,
    publicUrl: publicSiteOrigin({
      slug: siteSlug,
      vertical,
      verifiedHostname: verified ? plan.canonicalHostname : null,
    }),
  };
}

function aggregateTls(rows: DomainRow[]) {
  if (!rows.length) {
    return {
      status: "PENDING" as const,
      checkedAt: null,
      message: "Secure connection checks start after DNS is verified.",
    };
  }
  const status: DomainTlsStatus = rows.some((row) => row.tlsStatus === "ERROR")
    ? "ERROR"
    : rows.every((row) => row.tlsStatus === "READY")
      ? "READY"
      : "PENDING";
  return {
    status,
    checkedAt:
      rows
        .map((row) => row.tlsCheckedAt)
        .filter((value): value is Date => Boolean(value))
        .sort((left, right) => right.getTime() - left.getTime())[0] ?? null,
    message:
      status === "READY"
        ? "Secure HTTPS is ready."
        : status === "ERROR"
          ? safeTlsFailureMessage(rows)
          : "Certificate issuance is still in progress. Check again shortly.",
  };
}

function safeTlsFailureMessage(rows: DomainRow[]) {
  return rows.some((row) => row.tlsFailureCode === "INGRESS_UNREACHABLE")
    ? "The production ingress is not reachable yet. Try again shortly."
    : "The secure connection is not ready yet. Try again shortly.";
}

async function recordResolves(
  record: DomainHostnamePlan["records"][number],
  target: ReturnType<typeof getDomainTarget>,
) {
  if (record.type === "A") {
    const result = await Promise.allSettled([resolve4(record.hostname)]);
    return (
      result[0].status === "fulfilled" &&
      result[0].value.includes(target.address)
    );
  }
  const result = await Promise.allSettled([resolveCname(record.hostname)]);
  return (
    result[0].status === "fulfilled" &&
    result[0].value.some(
      (value) => value.replace(/\.$/, "").toLowerCase() === target.cname,
    )
  );
}

async function reconcileSiteStatus(
  transaction: Prisma.TransactionClient,
  siteId: string,
): Promise<SiteStatus> {
  const [site, verifiedDomainCount] = await Promise.all([
    transaction.site.findUnique({
      where: { id: siteId },
      select: {
        status: true,
        publishedSiteVersionId: true,
        publishedSiteVersion: {
          select: { id: true, siteId: true, publishedAt: true },
        },
      },
    }),
    transaction.domain.count({ where: { siteId, verified: true } }),
  ]);
  if (!site) throw new Error("Site not found");
  const published = site.publishedSiteVersion;
  const status = siteStatusForDomainState({
    currentStatus: site.status,
    hasVerifiedDomain: verifiedDomainCount > 0,
    hasValidPublishedVersion:
      Boolean(site.publishedSiteVersionId) &&
      published?.id === site.publishedSiteVersionId &&
      published.siteId === siteId &&
      published.publishedAt instanceof Date,
  });
  if (status !== site.status) {
    await transaction.site.update({
      where: { id: siteId },
      data: { status },
    });
  }
  return status;
}

function domainFailure(error: unknown, fallback: string) {
  const message =
    error instanceof z.ZodError
      ? error.issues[0]?.message ?? fallback
      : error instanceof Error &&
          error.message === "Customer domain routing is not configured"
        ? "Customer domain routing is not configured"
        : fallback;
  return Response.json(
    { error: message },
    { status: 400, headers: { "Cache-Control": "no-store" } },
  );
}
