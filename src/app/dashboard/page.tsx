import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Dashboard } from "@/app/dashboard/dashboard";
import { getSiteAnalyticsSummary } from "@/lib/analytics";
import { buildEmptyAnalyticsSummary } from "@/lib/analytics-contract";
import { getSiteAccess } from "@/lib/authorization";
import { getBookingRequestInbox } from "@/lib/booking-request-inbox";
import { getSiteBillingAccess } from "@/lib/billing-access";
import { getCurrentSession } from "@/lib/current-session";
import { Vertical } from "@/generated/prisma/enums";
import { publicSiteOrigin } from "@/lib/domain-routing";
import { getRestaurantOwnerDraft } from "@/lib/restaurants";
import { sampleRestaurant } from "@/lib/restaurant";
import { getSitePublicationHistory } from "@/lib/site-publication";
import { getSourceMonitoringDashboard } from "@/lib/source-monitoring";
import { resolveRequestBrand } from "@/lib/verticals/request-site";
import { listAccountWorkspaces } from "@/lib/workspaces";
import { UnsupportedVerticalDashboard } from "@/app/dashboard/unsupported-vertical-dashboard";
import { FoodRetailDashboard } from "@/app/dashboard/food-retail-dashboard";
import { LocalServiceDashboard } from "@/app/dashboard/local-service-dashboard";
import { findSiteDraft } from "@/lib/sites";
import type { FoodRetailSiteDraft } from "@/lib/verticals/food-retail/schema";
import type { LocalServiceSiteDraft } from "@/lib/verticals/local-service/schema";
import { EditorialFontScope } from "@/components/fonts/editorial-font-scope";

export async function generateMetadata(): Promise<Metadata> {
  const brand = await resolveRequestBrand();
  return {
    title: { absolute: `Dashboard | ${brand.name}` },
    robots: { index: false, follow: false },
  };
}

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ demo?: string; checkout?: string }>;
}) {
  const query = await searchParams;
  const session = await getCurrentSession();
  if (!session && query.demo !== "1") redirect("/sign-in");
  if (session?.purpose === "WORKSPACE_SELECTION") redirect("/workspace/select");
  if (session?.purpose === "ADMIN") redirect("/admin");
  if (session && session.purpose !== "SITE") redirect("/sign-in");

  const access = session?.siteSlug
    ? await getSiteAccess(session.siteSlug)
    : null;
  if (session && (!access || !access.ok)) redirect("/sign-in");

  if (access?.ok && access.site.vertical === Vertical.FOOD_RETAIL) {
    const [loaded, workspaces, publicationHistory] = await Promise.all([
      findSiteDraft(access.site.slug),
      listAccountWorkspaces(access.session.userId),
      getSitePublicationHistory(access.site.id),
    ]);
    if (!loaded || loaded.vertical !== Vertical.FOOD_RETAIL)
      redirect("/sign-in");
    return (
      <EditorialFontScope>
        <FoodRetailDashboard
          email={access.user.email}
          brand={await resolveRequestBrand()}
          initialDraft={loaded.draft as FoodRetailSiteDraft}
          initialRevision={loaded.revision}
          canSwitchWorkspace={workspaces.length > 1}
          initiallyPublished={publicationHistory.some((item) => item.current)}
          platformUrl={publicSiteOrigin({
            slug: access.site.slug,
            vertical: access.site.vertical,
          })}
        />
      </EditorialFontScope>
    );
  }

  if (access?.ok && access.site.vertical === Vertical.LOCAL_SERVICE) {
    const [loaded, workspaces, publicationHistory] = await Promise.all([
      findSiteDraft(access.site.slug),
      listAccountWorkspaces(access.session.userId),
      getSitePublicationHistory(access.site.id),
    ]);
    if (!loaded || loaded.vertical !== Vertical.LOCAL_SERVICE) {
      redirect("/sign-in");
    }
    return (
      <EditorialFontScope>
        <LocalServiceDashboard
          email={access.user.email}
          brand={await resolveRequestBrand()}
          initialDraft={loaded.draft as LocalServiceSiteDraft}
          initialRevision={loaded.revision}
          canSwitchWorkspace={workspaces.length > 1}
          initiallyPublished={publicationHistory.some((item) => item.current)}
          platformUrl={publicSiteOrigin({
            slug: access.site.slug,
            vertical: access.site.vertical,
          })}
        />
      </EditorialFontScope>
    );
  }

  if (access?.ok && access.site.vertical !== Vertical.RESTAURANT) {
    return (
      <EditorialFontScope>
        <UnsupportedVerticalDashboard
          email={access.user.email}
          slug={access.site.slug}
          vertical={access.site.vertical}
          brand={await resolveRequestBrand()}
        />
      </EditorialFontScope>
    );
  }

  const [
    ownerDraft,
    analyticsSummary,
    bookingInbox,
    billingAccess,
    publicationHistory,
    workspaces,
    sourceMonitoring,
  ] = access?.ok
    ? await Promise.all([
        getRestaurantOwnerDraft(access.site.slug),
        getSiteAnalyticsSummary(access.site.id),
        getBookingRequestInbox(access.site.id),
        getSiteBillingAccess(access.site.id),
        getSitePublicationHistory(access.site.id),
        listAccountWorkspaces(access.session.userId),
        getSourceMonitoringDashboard(access.site.id),
      ])
    : [
        { draft: sampleRestaurant, revision: 0 },
        buildEmptyAnalyticsSummary(),
        {
          requests: [],
          total: 0,
          awaitingContact: 0,
          truncated: false,
        },
        null,
        [],
        [],
        {
          cadenceDays: null,
          nextRunAt: null,
          lastRunAt: null,
          lastSuccessAt: null,
          lastFailureAt: null,
          lastFailureCode: null,
          latestRun: null,
          suggestions: [],
        },
      ];

  // A claimed restaurant without a loadable draft is a data integrity problem,
  // not a cue to invent sample content under the owner's real slug.
  if (access?.ok && !ownerDraft) {
    redirect("/sign-in");
  }

  return (
    <EditorialFontScope>
      <Dashboard
        initialDraft={ownerDraft?.draft ?? sampleRestaurant}
        initialDraftRevision={ownerDraft?.revision ?? 0}
        email={access?.ok ? access.user.email : "demo@cornershop.dev"}
        checkoutComplete={query.checkout === "success"}
        demo={!session}
        brand={await resolveRequestBrand()}
        analyticsSummary={analyticsSummary}
        bookingInbox={bookingInbox}
        billingAccess={billingAccess}
        publicationHistory={publicationHistory.map((item) => ({
          ...item,
          publishedAt: item.publishedAt.toISOString(),
        }))}
        canSwitchWorkspace={workspaces.length > 1}
        sourceMonitoring={sourceMonitoring}
        platformUrl={
          access?.ok
            ? publicSiteOrigin({
                slug: access.site.slug,
                vertical: access.site.vertical,
              })
            : publicSiteOrigin({
                slug: sampleRestaurant.slug,
                vertical: "RESTAURANT",
              })
        }
      />
    </EditorialFontScope>
  );
}
