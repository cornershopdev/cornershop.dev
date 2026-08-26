import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Dashboard } from "@/app/dashboard/dashboard";
import { getSiteAnalyticsSummary } from "@/lib/analytics";
import { buildEmptyAnalyticsSummary } from "@/lib/analytics-contract";
import { getSiteAccess } from "@/lib/authorization";
import { getBookingRequestInbox } from "@/lib/booking-request-inbox";
import { getCurrentSession } from "@/lib/current-session";
import { Vertical } from "@/generated/prisma/enums";
import { publicSiteOrigin } from "@/lib/domain-routing";
import { isOwnerOperationEnabled } from "@/lib/owner-operations";
import { loadOwnerPaidWorkspace } from "@/lib/owner-workspace";
import { getRestaurantOwnerDraft } from "@/lib/restaurants";
import { sampleRestaurant } from "@/lib/restaurant";
import {
  EMPTY_SOURCE_MONITORING_DASHBOARD,
  getSourceMonitoringDashboard,
} from "@/lib/source-monitoring";
import { resolveRequestBrand } from "@/lib/verticals/request-site";
import { resolveOwnerOperations } from "@/lib/verticals/registry";
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
    const capabilities = resolveOwnerOperations(access.site.vertical);
    const [loaded, paid, sourceMonitoring] = await Promise.all([
      findSiteDraft(access.site.slug),
      loadOwnerPaidWorkspace(access),
      isOwnerOperationEnabled(capabilities.sourceMonitoring)
        ? getSourceMonitoringDashboard(access.site.id)
        : EMPTY_SOURCE_MONITORING_DASHBOARD,
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
          canSwitchWorkspace={paid.canSwitchWorkspace}
          initiallyPublished={paid.publicationHistory.some((item) => item.current)}
          platformUrl={publicSiteOrigin({
            slug: access.site.slug,
            vertical: access.site.vertical,
          })}
          ownerOperations={paid.capabilities}
          billingAccess={paid.billingAccess}
          publicationHistory={paid.publicationHistory}
          sourceMonitoring={sourceMonitoring}
        />
      </EditorialFontScope>
    );
  }

  if (access?.ok && access.site.vertical === Vertical.LOCAL_SERVICE) {
    const capabilities = resolveOwnerOperations(access.site.vertical);
    const [loaded, paid, sourceMonitoring] = await Promise.all([
      findSiteDraft(access.site.slug),
      loadOwnerPaidWorkspace(access),
      isOwnerOperationEnabled(capabilities.sourceMonitoring)
        ? getSourceMonitoringDashboard(access.site.id)
        : EMPTY_SOURCE_MONITORING_DASHBOARD,
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
          canSwitchWorkspace={paid.canSwitchWorkspace}
          initiallyPublished={paid.publicationHistory.some((item) => item.current)}
          platformUrl={publicSiteOrigin({
            slug: access.site.slug,
            vertical: access.site.vertical,
          })}
          ownerOperations={paid.capabilities}
          billingAccess={paid.billingAccess}
          publicationHistory={paid.publicationHistory}
          sourceMonitoring={sourceMonitoring}
        />
      </EditorialFontScope>
    );
  }

  if (access?.ok && access.site.vertical !== Vertical.RESTAURANT) {
    const paid = await loadOwnerPaidWorkspace(access);
    return (
      <EditorialFontScope>
        <UnsupportedVerticalDashboard
          email={access.user.email}
          slug={access.site.slug}
          vertical={access.site.vertical}
          brand={await resolveRequestBrand()}
          canSwitchWorkspace={paid.canSwitchWorkspace}
        />
      </EditorialFontScope>
    );
  }

  const emptyBookingInbox = {
    requests: [],
    total: 0,
    awaitingContact: 0,
    truncated: false,
  };
  const restaurantCapabilities = access?.ok
    ? resolveOwnerOperations(access.site.vertical)
    : resolveOwnerOperations(Vertical.RESTAURANT);
  const [
    ownerDraft,
    analyticsSummary,
    bookingInbox,
    paid,
    sourceMonitoring,
  ] = access?.ok
    ? await Promise.all([
        getRestaurantOwnerDraft(access.site.slug),
        isOwnerOperationEnabled(restaurantCapabilities.analytics)
          ? getSiteAnalyticsSummary(access.site.id)
          : buildEmptyAnalyticsSummary(),
        isOwnerOperationEnabled(restaurantCapabilities.bookingInbox)
          ? getBookingRequestInbox(access.site.id)
          : emptyBookingInbox,
        loadOwnerPaidWorkspace(access),
        isOwnerOperationEnabled(restaurantCapabilities.sourceMonitoring)
          ? getSourceMonitoringDashboard(access.site.id)
          : EMPTY_SOURCE_MONITORING_DASHBOARD,
      ])
    : [
        { draft: sampleRestaurant, revision: 0 },
        buildEmptyAnalyticsSummary(),
        emptyBookingInbox,
        {
          capabilities: restaurantCapabilities,
          billingAccess: null,
          publicationHistory: [],
          workspaces: [],
          canSwitchWorkspace: false,
        },
        EMPTY_SOURCE_MONITORING_DASHBOARD,
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
        billingAccess={paid.billingAccess}
        publicationHistory={paid.publicationHistory}
        canSwitchWorkspace={paid.canSwitchWorkspace}
        sourceMonitoring={sourceMonitoring}
        ownerOperations={paid.capabilities}
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
